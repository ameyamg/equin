import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { answerThrowWith } from "@plugins/framework/plugins/http-router/core";
import {
  bodyMessages,
  hasInitialize,
  hasRequest,
  hasToolsList,
} from "./messages";
import { MCP_SERVER_NAME, MCP_UNATTACHED_ID } from "../../core";
import { runContribution } from "./isolate";
import type {
  McpConversationTool,
  McpTool,
  McpToolContext,
  McpToolResult,
} from "../../server";
import { recordMcpRequest } from "./health";
import { registry, scopeRegistry } from "../../server/internal/registry";
import {
  readToolsListed,
  recordToolsListed,
} from "../../server/internal/listed";
import { toolsInScope } from "./scope";
import { mcpSdk, type McpSdk } from "./sdk";

/**
 * The MCP route: answers one request, and records its outcome for the health
 * value (`mcp.health`) — a throw or a 5xx is the server failing its agents.
 * The throw is rethrown: recording it never absorbs it, and the router logs
 * and reports it. It is answered as a JSON-RPC error naming the call and its
 * cause (`mcpFailureResponse`) rather than the router's bare 500: the agent
 * reads the body, and "Internal server error" told it nothing (a 9 s Postgres
 * restart once failed every `browser_act` call that way, 2026-11-15).
 */
export function createMcpHandler(ports: McpPorts) {
  return async function handleMcpRequest(
    req: Request,
    params: Record<string, string>,
  ): Promise<Response> {
    const messages = await bodyMessages(req);
    let res: Response;
    try {
      res = await answerMcpRequest(req, params, messages, ports);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      recordMcpRequest({ ok: false, message: error.message });
      throw answerThrowWith(error, mcpFailureResponse(messages, error));
    }
    recordMcpRequest(
      res.status >= 500
        ? { ok: false, message: `Answered HTTP ${res.status}` }
        : { ok: true },
    );
    return res;
  };
}

/** What the request path writes outside itself. */
export interface McpPorts {
  /** Records the tools a `tools/list` answer to a conversation held. */
  recordListing(
    conversationId: string,
    tools: readonly string[],
  ): Promise<void>;
  /** The tools last listed to a conversation, `null` when none is recorded. */
  readListing(conversationId: string): Promise<readonly string[] | null>;
}

export const handleMcpRequest = createMcpHandler({
  recordListing: recordToolsListed,
  readListing: readToolsListed,
});

/** JSON-RPC's code for an error inside the server. */
const INTERNAL_ERROR = -32603;

/**
 * A failed request's answer: one JSON-RPC error per request it held (a batch
 * gets one each, a lone notification one with a null id), each naming what
 * was asked — the tool, for a `tools/call` — and the real cause.
 */
function mcpFailureResponse(
  messages: readonly unknown[],
  err: Error,
): Response {
  const requests = messages.flatMap((m) => {
    if (typeof m !== "object" || m === null) return [];
    const { id, method, params } = m as {
      id?: unknown;
      method?: unknown;
      params?: unknown;
    };
    if (id === undefined) return [];
    const tool = (params as { name?: unknown } | null | undefined)?.name;
    const what =
      method === "tools/call" && typeof tool === "string"
        ? `MCP tool "${tool}"`
        : `MCP request "${typeof method === "string" ? method : "?"}"`;
    return [{ id, what }];
  });
  const errors = (
    requests.length > 0 ? requests : [{ id: null, what: "MCP request" }]
  ).map(({ id, what }) => ({
    jsonrpc: "2.0",
    id,
    error: {
      code: INTERNAL_ERROR,
      message: `${what} failed: the equin server could not serve it: ${err.message}`,
    },
  }));
  return Response.json(errors.length === 1 ? errors[0] : errors, {
    status: 500,
  });
}

async function answerMcpRequest(
  req: Request,
  params: Record<string, string>,
  messages: readonly unknown[],
  ports: McpPorts,
): Promise<Response> {
  const conversationId = params.conversationId;
  if (!conversationId) {
    return new Response("Missing conversationId", { status: 400 });
  }
  const caller: McpCaller =
    conversationId === MCP_UNATTACHED_ID
      ? { kind: "unattached" }
      : { kind: "conversation", conversationId };

  const sdk = await mcpSdk();
  const server = newMcpServer(sdk);

  const { mounted, stale } =
    caller.kind === "unattached"
      ? { mounted: unattachedTools(), stale: false }
      : await conversationTools(caller.conversationId, messages, ports);
  for (const { tool, description } of mounted) {
    mountTool(server, tool, description, caller);
  }

  const transport = new sdk.WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  let res: Response;
  try {
    res = await transport.handleRequest(req);
  } finally {
    void server.close();
  }
  return stale ? await withToolsListChanged(res) : res;
}

/** The notice that makes a client ask for `tools/list` again. */
const TOOLS_LIST_CHANGED = {
  jsonrpc: "2.0",
  method: "notifications/tools/list_changed",
} as const;

/**
 * A JSON answer re-sent as the streamable-HTTP spec's other form of a POST's
 * answer: an SSE stream carrying `notifications/tools/list_changed`, then the
 * reply's messages, closed once they are written. A client keeps the tool list
 * it got at connect; this is how a stateless server (no session, no standing
 * GET stream to push on) tells it the list moved — Claude Code re-lists at
 * once and the agent can call a tool shipped or granted since it connected.
 * Only a 200 JSON answer is a reply to carry it on (an accepted notification
 * is a bodiless 202, an error status the transport's own refusal); anything
 * else is answered as is. The client's POST accepts the stream form: the
 * transport refused it otherwise (406) and that refusal is answered as is.
 */
async function withToolsListChanged(res: Response): Promise<Response> {
  const type = res.headers.get("content-type") ?? "";
  if (res.status !== 200 || !type.startsWith("application/json")) return res;
  const body = (await res.json()) as unknown;
  const replies = Array.isArray(body) ? body : [body];
  const events = [TOOLS_LIST_CHANGED, ...replies]
    .map((message) => `event: message\ndata: ${JSON.stringify(message)}\n\n`)
    .join("");
  const headers = new Headers(res.headers);
  headers.set("content-type", "text/event-stream");
  headers.set("cache-control", "no-cache, no-transform");
  headers.delete("content-length");
  return new Response(events, { status: 200, headers });
}

/**
 * Who a request is for: a conversation equin launched, or a session it did not
 * (`MCP_UNATTACHED_ID` — a `claude` started in a terminal).
 */
export type McpCaller =
  { kind: "conversation"; conversationId: string } | { kind: "unattached" };

interface MountedTool {
  tool: McpTool;
  description: string;
}

/**
 * An unattached session's tools: exactly those declared `unattached: true`.
 * No scope resolver, gate or live description runs — each is a function of a
 * conversation, and an unattached tool may declare none of them.
 */
function unattachedTools(): MountedTool[] {
  return [...registry.values()]
    .filter((tool) => tool.unattached === true)
    .map((tool) => ({ tool, description: tool.description }));
}

/**
 * A conversation's tools: its scope, then each tool's own `when` — and whether
 * its client's list is stale: the names it was last listed differ from these
 * (or none is recorded), so the answer tells it to re-list.
 */
async function conversationTools(
  conversationId: string,
  messages: readonly unknown[],
  ports: McpPorts,
): Promise<{ mounted: MountedTool[]; stale: boolean }> {
  // What the client holds, read beside the scope and the gates rather than
  // after them. Never rejects (`runContribution`), so a scope that throws
  // leaves no unhandled read behind.
  const held = askHeldListing(conversationId, messages, ports);

  // The conversation's scope: a scratch profile sees exactly its allowlist;
  // everyone else every tool reserved for no profile.
  const ctx = { conversationId };
  const scope = scopeRegistry.resolver
    ? await scopeRegistry.resolver(ctx)
    : { kind: "default" as const };

  // Live description sections likewise render only for the request that lists
  // the tools; a tool call never pays for them.
  const listing = hasToolsList(messages);
  const descriptions = listing ? await renderDescriptions(ctx) : null;

  // Per-conversation visibility: first the scope, then each tool's own `when`.
  // A tool either says no to is never registered on this request's server, so
  // it is absent from tools/list and a call to it is an unknown-tool error. The
  // gates run in parallel. A gate that throws hides only its own tool (fail
  // closed) and is reported; every other tool is unaffected.
  const tools = toolsInScope(registry, scope);
  const gates = await Promise.all(
    tools.map(async (tool) => {
      const when = tool.when;
      if (!when) return { ok: true as const, value: true };
      return await runContribution(`tool "${tool.name}" when`, () => when(ctx));
    }),
  );
  const mounted = tools.filter((_, i) => {
    const gate = gates[i];
    return gate !== undefined && gate.ok && gate.value;
  });
  // What this listing hands the client is what the session holds until it
  // reconnects: recorded, so a stop gate demands only a tool the agent has
  // (`toolCallableBy`). A failed record is reported and leaves the listing
  // served: the gates then read this conversation's previous listing, or
  // none (and spare it).
  const names = mounted.map((tool) => tool.name);
  if (listing) {
    await runContribution("listed-tools record", () =>
      ports.recordListing(conversationId, names),
    );
  }
  return {
    mounted: mounted.map((tool) => ({
      tool,
      description: descriptions?.get(tool.name) ?? tool.description,
    })),
    // A gate that threw hid its tool from this request only: what the
    // conversation should see is unknown, so it is no reason to re-list.
    stale:
      gates.every((gate) => gate.ok) && sameNames(await held, names) === false,
  };
}

/**
 * The listing this request's answer may have to correct, read when it should
 * be: the messages hold a request that is neither a listing (its answer IS the
 * fresh list) nor an `initialize` (the client lists right after). `skip` then
 * otherwise; a failed read is reported and is `skip` too — the answer is still
 * served, without a notice. `null` is no recorded listing (a session that
 * connected before the record existed — re-listing records it).
 */
async function askHeldListing(
  conversationId: string,
  messages: readonly unknown[],
  ports: McpPorts,
): Promise<readonly string[] | null | "skip"> {
  if (!hasRequest(messages) || hasToolsList(messages)) return "skip";
  if (hasInitialize(messages)) return "skip";
  const outcome = await runContribution("listed-tools read", () =>
    ports.readListing(conversationId),
  );
  return outcome.ok ? outcome.value : "skip";
}

/** Whether the held listing names exactly `names`, as a set; `null` when
 * there is nothing to compare (skipped), `false` when none is recorded. */
function sameNames(
  held: readonly string[] | null | "skip",
  names: readonly string[],
): boolean | null {
  if (held === "skip") return null;
  if (held === null) return false;
  const now = new Set(names);
  const listed = new Set(held);
  return now.size === listed.size && [...now].every((name) => listed.has(name));
}

/**
 * The server every MCP request (and the catalog's listing) runs on. It sends
 * no server instructions: Claude Code cuts them at 4,096 characters, silently.
 * How to use a tool belongs in its description; context about the agent and
 * its task is a `SystemPrompt.Section` (conversations/system-prompt).
 */
export function newMcpServer(sdk: McpSdk): McpServer {
  return new sdk.McpServer({ name: MCP_SERVER_NAME, version: "0.0.1" });
}

/** Registers one tool on a server, the one way both the request path and the
 * catalog's listing do, so the catalog lists exactly what agents receive. */
export function mountTool(
  server: McpServer,
  tool: McpTool,
  description: string,
  caller: McpCaller,
): void {
  // The request path mounts only `unattached: true` tools for an unattached
  // caller; reaching this is a bug in it, never an agent's doing.
  if (caller.kind === "unattached" && tool.unattached !== true) {
    throw new Error(
      `MCP tool "${tool.name}" needs a conversation, but was mounted for an unattached session`,
    );
  }
  server.registerTool(
    tool.name,
    { description, inputSchema: tool.inputSchema },
    (args: Record<string, unknown>, extra: { _meta?: unknown }) =>
      callTool(tool, args, caller, toolUseIdOf(extra._meta)),
  );
}

/** Runs one tool's handler with the context its kind declares. */
async function callTool(
  tool: McpTool,
  args: Record<string, unknown>,
  caller: McpCaller,
  toolUseId: string | null,
): Promise<McpToolResult> {
  if (tool.unattached === true) {
    const conversationId =
      caller.kind === "conversation" ? caller.conversationId : null;
    return await tool.handler(args, { conversationId, toolUseId });
  }
  if (caller.kind === "unattached") {
    throw new Error(
      `MCP tool "${tool.name}" needs a conversation, but was called by an unattached session`,
    );
  }
  return await tool.handler(args, {
    conversationId: caller.conversationId,
    toolUseId,
  });
}

/** Where Claude Code names the tool call a `tools/call` request answers. */
const TOOL_USE_ID_META = "claudecode/toolUseId";

/** The request's tool-use id, when its client sent one. */
function toolUseIdOf(meta: unknown): string | null {
  if (typeof meta !== "object" || meta === null) return null;
  const id = (meta as Record<string, unknown>)[TOOL_USE_ID_META];
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * Every tool's description with its live section appended — keyed by tool
 * name, for the tools that declare one. Rendered in parallel; a throwing
 * render fails only its own tool's section — reported, and the tool listed
 * with a notice that its live section is missing.
 */
async function renderDescriptions(
  ctx: McpToolContext,
): Promise<Map<string, string>> {
  const live = [...registry.values()].filter(
    (
      t,
    ): t is McpConversationTool &
      Required<Pick<McpConversationTool, "liveDescription">> =>
      t.liveDescription !== undefined,
  );
  const sections = await Promise.all(
    live.map(async (t) => {
      const outcome = await runContribution(
        `tool "${t.name}" live description`,
        () => t.liveDescription(ctx),
      );
      return outcome.ok
        ? outcome.value
        : `(This tool's live section failed to render (${outcome.message}) and has been reported.)`;
    }),
  );
  const out = new Map<string, string>();
  live.forEach((tool, i) => {
    const section = sections[i];
    if (section !== null && section !== undefined && section.trim() !== "") {
      out.set(tool.name, `${tool.description}\n\n${section}`);
    }
  });
  return out;
}
