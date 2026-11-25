import type { McpToolRegistration } from "@plugins/infra/plugins/mcp/server";
import { defineServerContribution } from "@plugins/framework/plugins/server-core/core";

/** What one gate says about a conversation's agent ending its turn. */
export type StopVerdict = { kind: "allow" } | { kind: "block"; reason: string };

/**
 * One plugin's reason an agent may not end its turn yet — work the plugin
 * still requires of it (a report it was asked for). `reason` is what the agent
 * reads as it is sent back to work, so it names the act that clears it.
 */
export interface StopGateEntry {
  /** Stable id, for logs and the docs. */
  id: string;
  /**
   * The MCP tools the agent clears this gate with — what its `reason` asks
   * it to call. The gate is enforced only while the agent can call every one
   * (`toolCallableBy`: listed to its session and visible now); otherwise its
   * block is dropped, since an agent cannot do what it was not given (a
   * session that connected before `turn_for` existed was held on it at every
   * turn, 2026-11-26). `[]` only for a gate cleared without a tool.
   */
  tools: readonly McpToolRegistration[];
  check(conversationId: string): Promise<StopVerdict>;
}

/**
 * One plugin's reason an agent may stop even though a gate blocks — it will be
 * woken anyway (a watch whose next event becomes its next turn). Answers the
 * reason, or null when it does not waive.
 */
export interface StopWaiverEntry {
  /** Stable id, for logs and the docs. */
  id: string;
  /**
   * When this waiver lets an agent stop, said to the agent: a blocked stop
   * lists every waiver's `when`, so the refusal always names the legal way to
   * wait instead of leaving the agent to find one (2026-11-15: an agent owing a
   * report could neither end its turn on a background run nor watch it in the
   * foreground). A clause completing "You may end your turn anyway while …".
   */
  when: string;
  waives(conversationId: string): Promise<string | null>;
}

export const StopGate = defineServerContribution<StopGateEntry>(
  "conversations.stop-gate",
  { docLabel: (g) => g.id },
);

export const StopWaiver = defineServerContribution<StopWaiverEntry>(
  "conversations.stop-waiver",
  { docLabel: (w) => w.id },
);
