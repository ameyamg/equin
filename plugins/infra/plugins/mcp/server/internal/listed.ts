import { eq, sql } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { defineRetention } from "@plugins/infra/plugins/retention/server";
import type { McpToolRegistration } from "./mcp";
import { registry } from "./registry";
import { _mcpListedTools } from "./tables";

/** Records the tools a `tools/list` answer to `conversationId` held. */
export async function recordToolsListed(
  conversationId: string,
  tools: readonly string[],
): Promise<void> {
  await db
    .insert(_mcpListedTools)
    .values({ conversationId, tools: [...tools] })
    .onConflictDoUpdate({
      target: _mcpListedTools.conversationId,
      set: { tools: [...tools], listedAt: sql`now()` },
    });
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
  const [row] = await db
    .select({ tools: _mcpListedTools.tools })
    .from(_mcpListedTools)
    .where(eq(_mcpListedTools.conversationId, conversationId));
  if (!row) return { callable: false, why: "never-listed" };
  if (!row.tools.includes(name)) return { callable: false, why: "not-listed" };
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
