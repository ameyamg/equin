import { db } from "@plugins/database/server";
import {
  ResumeBlockedError,
  resumeConversation,
  submitTurn,
} from "@plugins/conversations/server";
import type { LedgerTx } from "@plugins/conversations/plugins/turn-ledger/server";
import type { TurnId } from "@plugins/conversations/plugins/turn-ledger/core";
import { latestAgentConversation } from "./agents";

// Typing an event turn into an agent — the one path every sender takes
// (`message_agent`, and any plugin answering an agent): resume a stopped agent first,
// then submit the turn, typed now as a person's turn would be.

/** One event turn to type. */
export interface EventTurn {
  /** The ledger id: a retried send with the same id records nothing twice. Minted when absent. */
  id?: TurnId;
  text: string;
  /**
   * Run on the transaction that records the turn — only when this call
   * records it (never for a duplicate id). A throw rolls the record back and
   * nothing is typed (`submitTurn`'s `onRecorded`).
   */
  onRecorded?: (tx: LedgerTx) => Promise<void>;
}

/**
 * Bring a stopped (`gone`, or `done` when reopening) conversation back. A
 * blocked resume (its checkout reclaimed…) is a refusal carrying its reason;
 * anything else throws.
 */
export async function resumeAgent(
  conversationId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await resumeConversation(conversationId);
    return { ok: true };
  } catch (err) {
    if (err instanceof ResumeBlockedError)
      return { ok: false, message: err.message };
    throw err;
  }
}

/**
 * Type `turn` into `conversationId` as an event turn (held while it starts).
 * The caller resumed a stopped one first: a conversation stopped again in
 * between, or gone, throws.
 */
export async function typeEventTurn(
  conversationId: string,
  turn: EventTurn,
): Promise<{ turnId: TurnId }> {
  const out = await submitTurn(conversationId, {
    ...(turn.id === undefined ? {} : { id: turn.id }),
    kind: "event",
    text: turn.text,
    typedText: turn.text,
    ...(turn.onRecorded === undefined ? {} : { onRecorded: turn.onRecorded }),
  });
  if (out.kind === "not-found")
    throw new Error(`event turn: conversation ${conversationId} not found`);
  if (out.kind === "stopped")
    throw new Error(
      `event turn: conversation ${conversationId} is ${out.status}`,
    );
  return { turnId: out.turn.id };
}

/** Where one event turn to a task's agent went. */
export type EventDelivery =
  | {
      kind: "delivered";
      conversationId: string;
      turnId: TurnId;
      /** The agent was stopped (`gone`) and was resumed for it. */
      resumed: boolean;
    }
  /** No agent ran on the task: nobody to type into. */
  | { kind: "no-agent" }
  /**
   * The task's agent closed (`done`) — it ended its own work. Nothing is
   * typed and it is not reopened: a closed agent is reopened only by its
   * supervisor (`message_agent`'s `reopen`).
   */
  | { kind: "finished"; conversationId: string }
  /** It is stopped and cannot be resumed; nothing typed. */
  | { kind: "resume-blocked"; conversationId: string; message: string };

/**
 * Type one event turn into `taskId`'s agent — its LATEST conversation working
 * under the task's mandate (`latestAgentConversation`, as `message_agent`
 * addresses it). A stopped (`gone`) one is resumed first; a closed one is left
 * closed. A task no agent ran on (or none at all) is `no-agent`.
 */
export async function deliverEventTurn(
  taskId: string,
  turn: EventTurn,
): Promise<EventDelivery> {
  const conversation = await latestAgentConversation(db, taskId);
  if (conversation === null) return { kind: "no-agent" };
  if (conversation.status === "done")
    return { kind: "finished", conversationId: conversation.id };
  const resumed = conversation.status === "gone";
  if (resumed) {
    const r = await resumeAgent(conversation.id);
    if (!r.ok)
      return {
        kind: "resume-blocked",
        conversationId: conversation.id,
        message: r.message,
      };
  }
  const { turnId } = await typeEventTurn(conversation.id, turn);
  return {
    kind: "delivered",
    conversationId: conversation.id,
    turnId,
    resumed,
  };
}
