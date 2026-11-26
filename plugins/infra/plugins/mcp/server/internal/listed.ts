import { eq, sql } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { defineRetention } from "@plugins/infra/plugins/retention/server";
import type { McpToolRegistration } from "./mcp";
import { registry } from "./registry";
import { _mcpListedTools } from "./tables";

/**
 * What a `tools/list` answer to a conversation held: the tools' names, and the
 * fingerprint of everything it handed them with (names, descriptions, input
 * schemas) — `null` for a listing recorded before the fingerprint was.
 */
export interface ToolsListing {
  tools: readonly string[];
  fingerprint: string | null;
}

/** Records what a `tools/list` answer to `conversationId` held. */
export async function recordToolsListed(
  conversationId: string,
  listing: { tools: readonly string[]; fingerprint: string },
): Promise<void> {
  const tools = [...listing.tools];
  const { fingerprint } = listing;
  await db
    .insert(_mcpListedTools)
    .values({ conversationId, tools, fingerprint })
    .onConflictDoUpdate({
      target: _mcpListedTools.conversationId,
      set: { tools, fingerprint, listedAt: sql`now()` },
    });
}

/**
 * The listing last handed to `conversationId` — what its client holds — or
 * `null` when none is recorded (`never-listed` below).
 */
export async function readToolsListed(
  conversationId: string,
): Promise<ToolsListing | null> {
  const [row] = await db
    .select({
      tools: _mcpListedTools.tools,
      fingerprint: _mcpListedTools.fingerprint,
    })
    .from(_mcpListedTools)
    .where(eq(_mcpListedTools.conversationId, conversationId));
  return row ?? null;
}

/**
 * Whether a conversation's agent can call a tool now: listed to it (its
 * client knows the tool exists) and its `when` still true (else the call is an
 * unknown-tool error). Otherwise why not:
 * - `never-listed` — no listing recorded (a session that connected before the
 *   record existed, or longer ago than its retention);
 * - `not-listed` — its client's list lacks the tool (added, or granted, since
 *   it connected);
 * - `hidden` — listed, but its `when` is false now.
 * A tool not registered in this process throws: a caller asking about it is
 * a bug (its plugin is not mounted where the gate runs).
 */
export type ToolReach =
  | { callable: true }
  | { callable: false; why: "never-listed" | "not-listed" | "hidden" };

export async function toolCallableBy(
  conversationId: string,
  ref: McpToolRegistration,
): Promise<ToolReach> {
  const name = ref.toolName;
  const tool = registry.get(name);
  if (!tool) throw new Error(`MCP tool "${name}" is not registered here`);
  const listed = await readToolsListed(conversationId);
  if (!listed) return { callable: false, why: "never-listed" };
  if (!listed.tools.includes(name))
    return { callable: false, why: "not-listed" };
  if (tool.when && !(await tool.when({ conversationId })))
    return { callable: false, why: "hidden" };
  return { callable: true };
}

/**
 * A listing untouched for 30 days is a session long gone (every connect
 * relists). One still alive past it reads `never-listed`, as before the record.
 */
export const listedToolsRetention = defineRetention({
  table: _mcpListedTools,
  column: "listedAt",
  ttlDays: 30,
});
