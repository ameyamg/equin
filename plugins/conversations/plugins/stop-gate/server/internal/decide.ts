import type { McpToolRegistration } from "@plugins/infra/plugins/mcp/server";
import type { StopGateResponse } from "../../core";
import type { StopGateEntry, StopVerdict, StopWaiverEntry } from "./registry";

/**
 * The decision from what the gates and waivers said: `block` iff some gate
 * blocks and no waiver waives — every blocking reason joined, then each
 * waiver's `when` (`waysToStop`), so the agent reads how it may stop while it
 * waits. A waived block is an `allow` carrying the waivers' reasons, for the
 * log.
 */
export function decideStop(
  verdicts: readonly StopVerdict[],
  waivers: readonly (string | null)[],
  waysToStop: readonly string[],
): StopGateResponse {
  const blocks = verdicts.flatMap((v) =>
    v.kind === "block" ? [v.reason] : [],
  );
  if (blocks.length === 0) return { decision: "allow", reason: null };
  const waived = waivers.filter((w): w is string => w !== null);
  if (waived.length > 0) {
    return { decision: "allow", reason: waived.join("\n\n") };
  }
  const reason = blocks.join("\n\n");
  if (waysToStop.length === 0) return { decision: "block", reason };
  return {
    decision: "block",
    reason:
      `${reason}\n\nYou may end your turn anyway while:\n` +
      waysToStop.map((w) => `- ${w}`).join("\n"),
  };
}

/** Whether the conversation's agent can call an MCP tool now (mcp's `toolCallableBy`). */
export type ToolCallable = (
  conversationId: string,
  tool: McpToolRegistration,
) => Promise<{ callable: boolean }>;

/**
 * Ask every gate, and — only when one blocks — every waiver. A block stands
 * only while the agent can call every tool its gate is cleared with: a gate
 * may never demand what the session does not have. One that throws fails the
 * whole decision, loudly: the hook then fails open, and says so.
 */
export async function evaluateStop(
  conversationId: string,
  gates: readonly StopGateEntry[],
  waivers: readonly StopWaiverEntry[],
  callable: ToolCallable,
): Promise<StopGateResponse> {
  const verdicts = await Promise.all(
    gates.map(async (g) => {
      const verdict = await g.check(conversationId);
      if (verdict.kind === "allow") return verdict;
      const reach = await Promise.all(
        g.tools.map((tool) => callable(conversationId, tool)),
      );
      return reach.every((r) => r.callable)
        ? verdict
        : ({ kind: "allow" } as const);
    }),
  );
  if (!verdicts.some((v) => v.kind === "block")) {
    return decideStop(verdicts, [], []);
  }
  const waived = await Promise.all(
    waivers.map((w) => w.waives(conversationId)),
  );
  return decideStop(
    verdicts,
    waived,
    waivers.map((w) => w.when),
  );
}
