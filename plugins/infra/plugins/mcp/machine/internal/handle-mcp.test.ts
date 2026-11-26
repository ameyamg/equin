/**
 * The MCP request path: no server instructions at initialize, live
 * descriptions on tools/list, `when` gates, the call context.
 *
 * Run: `./equin test plugins/infra/plugins/mcp`
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { setServerErrorHandler } from "@plugins/framework/plugins/server-core/core/testing";
import { createRequestHandler } from "@plugins/framework/plugins/http-router/core";
import { createMcpHandler } from "./handle-mcp";
import { Mcp, type McpToolContext } from "../../server";
import { MCP_UNATTACHED_ID } from "../../core";
import { registry, scopeRegistry } from "../../server/internal/registry";
import type { ToolsListing } from "../../server/internal/listed";

/** Every tools/list answer, as the request path recorded it. */
const listings: ({ conversationId: string } & ToolsListing)[] = [];
const handleMcpRequest = createMcpHandler({
  recordListing: (conversationId, listing) => {
    listings.push({ conversationId, ...listing });
    return Promise.resolve();
  },
  readListing: (conversationId) => readListing(conversationId),
});

/** The port's read of a conversation's listing: by default its latest one. */
let readListing: (conversationId: string) => Promise<ToolsListing | null>;

function latestListing(conversationId: string): ToolsListing | null {
  return listings.findLast((l) => l.conversationId === conversationId) ?? null;
}

/** The messages an answer carries, in order, whichever form it was sent in. */
async function messagesOf(res: Response): Promise<unknown[]> {
  const type = res.headers.get("content-type") ?? "";
  if (type.startsWith("text/event-stream")) {
    return (await res.text())
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice("data: ".length)) as unknown);
  }
  const body = (await res.json()) as unknown;
  return Array.isArray(body) ? body : [body];
}

/** A one-request answer's reply, whichever form it was sent in. */
async function replyOf(res: Response): Promise<unknown> {
  const replies = (await messagesOf(res)).filter(
    (m) => (m as { id?: unknown }).id !== undefined,
  );
  if (replies.length !== 1) throw new Error(`${replies.length} replies`);
  return replies[0];
}

const CONVERSATION = "conv-test";

function post(body: unknown, conversation = CONVERSATION): Promise<Response> {
  return handleMcpRequest(
    new Request(`http://localhost/api/mcp/${conversation}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    }),
    { conversationId: conversation },
  );
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0.0.0" },
  },
};

let reported: string[] = [];

beforeEach(() => {
  reported = [];
  listings.length = 0;
  readListing = (id) => Promise.resolve(latestListing(id));
  setServerErrorHandler((report) => reported.push(report.message));
  registry.clear();
  void Mcp.tool({
    name: "echo",
    description: "Echo",
    inputSchema: { text: z.string() },
    handler: (args) => ({ content: [{ type: "text", text: args.text }] }),
  }).register();
});

afterEach(() => {
  registry.clear();
});

describe("server instructions", () => {
  test("initialize carries none: agent context is a system-prompt section", async () => {
    const res = await post(initialize);
    const body = (await res.json()) as { result: { instructions?: string } };
    expect(body.result.instructions).toBeUndefined();
  });
});

describe("Mcp.tool liveDescription", () => {
  let liveRenders = 0;

  function liveTool(name: string, section: string | null): void {
    void Mcp.tool({
      name,
      description: "Fixed.",
      liveDescription: () => {
        liveRenders += 1;
        return Promise.resolve(section);
      },
      inputSchema: {},
      handler: () => ({ content: [{ type: "text", text: "ok" }] }),
    }).register();
  }

  async function listed(): Promise<Map<string, string>> {
    const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const json = (await res.json()) as {
      result: { tools: Array<{ name: string; description: string }> };
    };
    return new Map(json.result.tools.map((t) => [t.name, t.description]));
  }

  beforeEach(() => {
    liveRenders = 0;
  });

  test("tools/list appends the live section after a blank line", async () => {
    liveTool("live", "Known: A, B.");
    const tools = await listed();
    expect(tools.get("live")).toBe("Fixed.\n\nKnown: A, B.");
    expect(tools.get("echo")).toBe("Echo");
  });

  test("a null section leaves the fixed description", async () => {
    liveTool("live", null);
    expect((await listed()).get("live")).toBe("Fixed.");
  });

  test("a throwing section keeps the tool listed with a notice, reported", async () => {
    void Mcp.tool({
      name: "live",
      description: "Fixed.",
      liveDescription: () => Promise.reject(new Error("db down")),
      inputSchema: {},
      handler: () => ({ content: [{ type: "text", text: "ok" }] }),
    }).register();
    const tools = await listed();
    expect(tools.get("live")).toStartWith("Fixed.\n\n");
    expect(tools.get("live")).toContain("db down");
    expect(tools.get("echo")).toBe("Echo");
    expect(reported).toEqual([
      'MCP tool "live" live description failed: db down',
    ]);
  });

  test("only tools/list renders it", async () => {
    liveTool("live", "Known.");
    await post(initialize);
    await post({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "live", arguments: {} },
    });
    expect(liveRenders).toBe(0);
    await listed();
    expect(liveRenders).toBe(1);
  });
});

describe("Mcp.tool when", () => {
  let gated: McpToolContext[] = [];

  function gate(name: string, visible: boolean | Promise<boolean>): void {
    void Mcp.tool({
      name,
      description: name,
      inputSchema: {},
      when: (ctx) => {
        gated.push(ctx);
        return visible;
      },
      handler: () => ({ content: [{ type: "text", text: name }] }),
    }).register();
  }

  async function listed(): Promise<string[]> {
    const res = await post({ jsonrpc: "2.0", id: 4, method: "tools/list" });
    const json = (await res.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    return json.result.tools.map((t) => t.name);
  }

  async function call(name: string): Promise<unknown> {
    const res = await post({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name, arguments: {} },
    });
    return replyOf(res);
  }

  beforeEach(() => {
    gated = [];
  });

  test("a tool whose when is false is not listed", async () => {
    gate("shown", true);
    gate("shown-async", Promise.resolve(true));
    gate("hidden", false);
    expect((await listed()).sort()).toEqual(["echo", "shown", "shown-async"]);
    expect(gated).toContainEqual({ conversationId: CONVERSATION });
  });

  test("a tools/list records exactly the tools it listed; a call records nothing", async () => {
    listings.length = 0;
    gate("shown", true);
    gate("hidden", false);
    const names = await listed();
    expect(listings).toEqual([
      {
        conversationId: CONVERSATION,
        tools: names,
        fingerprint: expect.any(String) as string,
      },
    ]);
    expect([...names].sort()).toEqual(["echo", "shown"]);
    await call("shown");
    expect(listings).toHaveLength(1);
  });

  test("an unattached session's listing is not recorded", async () => {
    listings.length = 0;
    await post(
      { jsonrpc: "2.0", id: 4, method: "tools/list" },
      MCP_UNATTACHED_ID,
    );
    expect(listings).toEqual([]);
  });

  test("a tool whose when is false is refused on call", async () => {
    gate("hidden", Promise.resolve(false));
    const json = (await call("hidden")) as {
      result?: { isError?: boolean; content: Array<{ text: string }> };
      error?: { message: string };
    };
    // The SDK answers an unknown tool with either a JSON-RPC error or an
    // isError result depending on version; either way, the handler never ran.
    const refused =
      json.error !== undefined ||
      (json.result?.isError === true &&
        json.result.content[0]?.text !== "hidden");
    expect(refused).toBe(true);
  });

  test("a throwing when hides only its own tool, reported", async () => {
    gate("shown", true);
    gate("broken", Promise.reject(new Error("gate failed")));
    expect((await listed()).sort()).toEqual(["echo", "shown"]);
    expect(reported).toEqual(['MCP tool "broken" when failed: gate failed']);
  });

  test("a visible gated tool is callable", async () => {
    gate("shown", true);
    const json = (await call("shown")) as {
      result: { content: Array<{ text: string }> };
    };
    expect(json.result.content[0]?.text).toBe("shown");
  });
});

describe("Mcp.tool call context", () => {
  let calls = 0;
  async function toolUseIdSeen(meta: unknown): Promise<string | null> {
    let seen: string | null | undefined;
    const name = `who-${++calls}`;
    void Mcp.tool({
      name,
      description: "Who called",
      inputSchema: {},
      handler: (_args, ctx) => {
        seen = ctx.toolUseId;
        return { content: [{ type: "text", text: "ok" }] };
      },
    }).register();
    await post({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name,
        arguments: {},
        ...(meta !== undefined ? { _meta: meta } : {}),
      },
    });
    if (seen === undefined) throw new Error("the handler never ran");
    return seen;
  }

  test("the client's tool-use id reaches the handler", async () => {
    expect(await toolUseIdSeen({ "claudecode/toolUseId": "toolu_abc" })).toBe(
      "toolu_abc",
    );
  });

  test("no id sent is null", async () => {
    expect(await toolUseIdSeen(undefined)).toBeNull();
    expect(await toolUseIdSeen({ other: 1 })).toBeNull();
  });
});

describe("unattached sessions", () => {
  let seen: Array<string | null> = [];
  let gateRuns = 0;
  let scopeRuns = 0;

  beforeEach(() => {
    seen = [];
    gateRuns = 0;
    scopeRuns = 0;
    void Mcp.tool({
      name: "anywhere",
      description: "Answers without a conversation",
      unattached: true,
      inputSchema: {},
      handler: (_args, ctx) => {
        seen.push(ctx.conversationId);
        return { content: [{ type: "text", text: "ok" }] };
      },
    }).register();
    void Mcp.tool({
      name: "gated",
      description: "Mandate-gated",
      inputSchema: {},
      when: () => {
        gateRuns += 1;
        return true;
      },
      handler: () => ({ content: [{ type: "text", text: "gated" }] }),
    }).register();
    scopeRegistry.resolver = () => {
      scopeRuns += 1;
      return Promise.resolve({ kind: "default" });
    };
  });

  afterEach(() => {
    scopeRegistry.resolver = null;
  });

  async function listed(conversation: string): Promise<string[]> {
    const res = await post(
      { jsonrpc: "2.0", id: 10, method: "tools/list" },
      conversation,
    );
    const json = (await res.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    return json.result.tools.map((t) => t.name).sort();
  }

  async function call(name: string, conversation: string): Promise<unknown> {
    const res = await post(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name, arguments: {} },
      },
      conversation,
    );
    return replyOf(res);
  }

  test("lists only the tools declared unattached, running no scope or gate", async () => {
    expect(await listed(MCP_UNATTACHED_ID)).toEqual(["anywhere"]);
    expect(scopeRuns).toBe(0);
    expect(gateRuns).toBe(0);
  });

  test("a conversation still sees every tool, unattached ones included", async () => {
    expect(await listed(CONVERSATION)).toEqual(["anywhere", "echo", "gated"]);
  });

  test("the handler gets a null conversation unattached, the id otherwise", async () => {
    await call("anywhere", MCP_UNATTACHED_ID);
    await call("anywhere", CONVERSATION);
    expect(seen).toEqual([null, CONVERSATION]);
  });

  test("a conversation-only tool is refused, its handler never run", async () => {
    const json = (await call("gated", MCP_UNATTACHED_ID)) as {
      result?: { isError?: boolean; content: Array<{ text: string }> };
      error?: { message: string };
    };
    const refused =
      json.error !== undefined ||
      (json.result?.isError === true &&
        json.result.content[0]?.text !== "gated");
    expect(refused).toBe(true);
    expect(gateRuns).toBe(0);
  });
});

describe("a request the server fails to serve", () => {
  afterEach(() => {
    scopeRegistry.resolver = null;
  });

  // 2026-11-15: Postgres restarted for 9 s; the scope read threw before the
  // SDK ran, and every browser_act call answered the router's bare
  // "Internal server error" — the agent could not tell what failed.
  test("a tools/call answers a JSON-RPC error naming the tool and the cause, still logged", async () => {
    scopeRegistry.resolver = () =>
      Promise.reject(new Error("the database system is shutting down"));
    const logged: string[] = [];
    const handle = createRequestHandler({
      routes: [["POST /api/mcp/:conversationId", handleMcpRequest]],
      onError: (err) => logged.push(err.message),
    });
    const res = await handle(
      new Request(`http://localhost/api/mcp/${CONVERSATION}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "echo", arguments: { text: "hi" } },
        }),
      }),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: {
        code: -32603,
        message:
          'MCP tool "echo" failed: the equin server could not serve it: the database system is shutting down',
      },
    });
    expect(logged).toEqual(["the database system is shutting down"]);
  });
});

describe("a client whose tool list is stale", () => {
  const LIST_CHANGED = {
    jsonrpc: "2.0",
    method: "notifications/tools/list_changed",
  };

  function callEcho(id = 20): Promise<Response> {
    return post({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hi" } },
    });
  }

  function gated(name: string, open: () => boolean): void {
    void Mcp.tool({
      name,
      description: name,
      inputSchema: {},
      when: () => open(),
      handler: () => ({ content: [{ type: "text", text: name }] }),
    }).register();
  }

  test("a listing that still matches is answered as plain JSON", async () => {
    await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const res = await callEcho();
    expect(res.headers.get("content-type")).toStartWith("application/json");
    expect(await res.json()).toMatchObject({ id: 20, result: {} });
  });

  // conv-1795638366-ye3yup: connected before turn_for shipped, it never got
  // the tool. Shipping one (or its `when` turning true) is the same change.
  test("a tool visible since the listing: the reply streams list_changed first", async () => {
    let open = false;
    gated("granted", () => open);
    await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(latestListing(CONVERSATION)?.tools).toEqual(["echo"]);
    open = true;
    const res = await callEcho();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const [first, second, ...rest] = await messagesOf(res);
    expect(first).toEqual(LIST_CHANGED);
    expect(second).toMatchObject({
      id: 20,
      result: { content: [{ type: "text", text: "hi" }] },
    });
    expect(rest).toEqual([]);
    // The client re-lists: the record moves, and the next answer is JSON.
    await post({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const after = await callEcho(21);
    expect(after.headers.get("content-type")).toStartWith("application/json");
  });

  test("a tool hidden since the listing streams it too", async () => {
    let open = true;
    gated("revoked", () => open);
    await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    open = false;
    expect((await messagesOf(await callEcho()))[0]).toEqual(LIST_CHANGED);
  });

  test("the same tools mounted in another order are no change", async () => {
    gated("b", () => true);
    await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    // Re-registered in the other order: same tools, other mount order.
    const [echo, b] = [registry.get("echo"), registry.get("b")];
    if (!echo || !b) throw new Error("missing tools");
    registry.clear();
    registry.set("b", b);
    registry.set("echo", echo);
    const res = await callEcho();
    expect(res.headers.get("content-type")).toStartWith("application/json");
  });

  /** Re-registers `echo` as the given declaration — a deploy that changed it. */
  function redeclareEcho(change: {
    description?: string;
    inputSchema?: z.ZodRawShape;
  }): void {
    registry.delete("echo");
    void Mcp.tool({
      name: "echo",
      description: change.description ?? "Echo",
      inputSchema: change.inputSchema ?? { text: z.string() },
      handler: (args) => ({
        content: [{ type: "text", text: String(args.text) }],
      }),
    }).register();
  }

  // dbf4fa023a reworded turn_for and added a field: sessions connected before
  // it kept the old text, and a call using the new field was refused.
  test("a tool reworded since the listing streams it", async () => {
    await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    redeclareEcho({ description: "Echo, reworded" });
    expect((await messagesOf(await callEcho()))[0]).toEqual(LIST_CHANGED);
    await post({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const after = await callEcho(21);
    expect(after.headers.get("content-type")).toStartWith("application/json");
  });

  test("a tool whose input schema changed since the listing streams it", async () => {
    await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    redeclareEcho({
      inputSchema: { text: z.string(), awaiting: z.string().optional() },
    });
    expect((await messagesOf(await callEcho()))[0]).toEqual(LIST_CHANGED);
  });

  test("the same declaration registered again is no change", async () => {
    await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    redeclareEcho({});
    const res = await callEcho();
    expect(res.headers.get("content-type")).toStartWith("application/json");
  });

  test("a live section that moved since the listing is no change", async () => {
    let section = "one";
    void Mcp.tool({
      name: "vocab",
      description: "vocab",
      inputSchema: {},
      liveDescription: () => Promise.resolve(section),
      handler: () => ({ content: [{ type: "text", text: "ok" }] }),
    }).register();
    await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    section = "two";
    const res = await callEcho();
    expect(res.headers.get("content-type")).toStartWith("application/json");
  });

  test("a listing recorded before fingerprints streams it", async () => {
    readListing = () => Promise.resolve({ tools: ["echo"], fingerprint: null });
    expect((await messagesOf(await callEcho()))[0]).toEqual(LIST_CHANGED);
  });

  test("no recorded listing (connected before the record) streams it", async () => {
    const res = await callEcho();
    expect((await messagesOf(res))[0]).toEqual(LIST_CHANGED);
  });

  test("a listing, an initialize or a lone notification never carries it", async () => {
    let reads = 0;
    readListing = () => {
      reads += 1;
      return Promise.resolve(null);
    };
    const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(list.headers.get("content-type")).toStartWith("application/json");
    const init = await post(initialize);
    expect(init.headers.get("content-type")).toStartWith("application/json");
    const note = await post({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(note.status).toBe(202);
    expect(reads).toBe(0);
  });

  test("a batch streams the notice once, then every reply", async () => {
    const res = await post([
      { jsonrpc: "2.0", id: 30, method: "ping" },
      {
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: { name: "echo", arguments: { text: "x" } },
      },
    ]);
    const messages = await messagesOf(res);
    expect(messages[0]).toEqual(LIST_CHANGED);
    expect(
      messages
        .slice(1)
        .map((m) => (m as { id: number }).id)
        .sort(),
    ).toEqual([30, 31]);
  });

  test("an unattached session is never told", async () => {
    let reads = 0;
    readListing = () => {
      reads += 1;
      return Promise.resolve(null);
    };
    void Mcp.tool({
      name: "anywhere",
      description: "anywhere",
      unattached: true,
      inputSchema: {},
      handler: () => ({ content: [{ type: "text", text: "ok" }] }),
    }).register();
    const res = await post(
      {
        jsonrpc: "2.0",
        id: 40,
        method: "tools/call",
        params: { name: "anywhere", arguments: {} },
      },
      MCP_UNATTACHED_ID,
    );
    expect(res.headers.get("content-type")).toStartWith("application/json");
    expect(reads).toBe(0);
  });

  test("a gate that threw is no reason to re-list", async () => {
    let broken = false;
    gated("flaky", () => {
      if (broken) throw new Error("gate down");
      return true;
    });
    await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    broken = true;
    const res = await callEcho();
    expect(res.headers.get("content-type")).toStartWith("application/json");
    expect(reported).toEqual(['MCP tool "flaky" when failed: gate down']);
  });

  test("a failed read is reported and the reply still served as JSON", async () => {
    readListing = () => Promise.reject(new Error("db down"));
    const res = await callEcho();
    expect(res.headers.get("content-type")).toStartWith("application/json");
    expect(await res.json()).toMatchObject({ id: 20, result: {} });
    expect(reported).toEqual(["MCP listed-tools read failed: db down"]);
  });
});
