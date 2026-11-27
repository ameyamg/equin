import { db } from "@plugins/database/server";
import {
  resolvePromptAttachments,
  ResumeBlockedError,
  resumeConversation,
  submitTurn,
} from "@plugins/conversations/server";
import type { LedgerTx } from "@plugins/conversations/plugins/turn-ledger/server";
import type { TurnId } from "@plugins/conversations/plugins/turn-ledger/core";
import type { PromptMarkdown } from "@plugins/primitives/plugins/text-editor/core";
import { latestAgentConversation } from "./agents";

// Typing an event turn into an agent — the one path every sender takes
// (`message_agent`, and any plugin answering an agent): resume a stopped agent
// first (and a closed one, when the sender says so), then submit the turn,
// typed now as a person's turn would be. What a person wrote in it is resolved
// HERE — attachment refs as disk paths, the attachments linked to the
// conversation — so no sender can forget it.

/**
 * One event turn to type: the text the server writes around what a person
 * wrote (`userText`, by key), rendered by `text` — once with each user part as
 * written (the turn's shown text, so its images still draw) and once as the
 * agent reads it (each attachment ref its disk path).
 */
export interface EventTurn<K extends string = string> {
  /** The ledger id: a retried send with the same id records nothing twice. Minted when absent. */
  id?: TurnId;
  /**
   * What a person wrote for the agent in the prompt field, by key — `{}` for
   * a turn only the code wrote (`message_agent`'s, an agent's own words).
   */
  userText: Readonly<Record<K, PromptMarkdown>>;
  /** The turn's text, `userText`'s parts embedded where the sender places them. */
  text: (userText: Readonly<Record<K, string>>) => string;
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

/** Each user part as the agent of `conversationId` reads it (and its attachments linked there). */
async function agentReads<K extends string>(
  conversationId: string,
  userText: Readonly<Record<K, PromptMarkdown>>,
): Promise<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(userText) as K[])
    out[key] = await resolvePromptAttachments(conversationId, userText[key]);
  return out;
}

/**
 * Type `turn` into `conversationId` as an event turn (held while it starts).
 * The caller resumed a stopped one first: a conversation stopped again in
 * between, or gone, throws.
 */
export async function typeEventTurn<K extends string>(
  conversationId: string,
  turn: EventTurn<K>,
): Promise<{ turnId: TurnId }> {
  const written = turn.userText;
  const out = await submitTurn(conversationId, {
    ...(turn.id === undefined ? {} : { id: turn.id }),
    kind: "event",
    text: turn.text(written),
    typedText: turn.text(await agentReads(conversationId, written)),
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

/**
 * What delivery does with a task's agent that closed (`done`) — it ended its
 * own work. Every sender decides; there is no default.
 * - `reopen`: resume it and type the turn (an answer it waits on even once
 *   closed: a decision on its proposal).
 * - `leave`: type nothing and leave it closed (`finished`) — the sender keeps
 *   what it would have said (an answer to a finished agent's decision).
 */
export type IfClosed = "reopen" | "leave";

/** Where one event turn to a task's agent went. */
export type EventDelivery<P extends IfClosed = IfClosed> =
  | {
      kind: "delivered";
      conversationId: string;
      turnId: TurnId;
      /**
       * How the agent stood when the turn came: `running` (or starting),
       * `stopped` (`gone`, resumed for it), `closed` (`done`, reopened for it).
       */
      was: "running" | "stopped" | ("reopen" extends P ? "closed" : never);
    }
  /** No agent ran on the task: nobody to type into. */
  | { kind: "no-agent" }
  /** It is stopped (or closed, reopening) and cannot be resumed; nothing typed. */
  | { kind: "resume-blocked"; conversationId: string; message: string }
  | ("leave" extends P
      ? /** The agent closed and `ifClosed` is `leave`: nothing typed, left closed. */
        { kind: "finished"; conversationId: string }
      : never);

/**
 * Type one event turn into `taskId`'s agent — its LATEST conversation working
 * under the task's mandate (`latestAgentConversation`, as `message_agent`
 * addresses it). A stopped (`gone`) one is resumed first; a closed one is
 * reopened or left closed as `ifClosed` says. A task no agent ran on (or none
 * at all) is `no-agent`.
 */
export function deliverEventTurn<K extends string>(
  taskId: string,
  turn: EventTurn<K>,
  options: { ifClosed: "reopen" },
): Promise<EventDelivery<"reopen">>;
export function deliverEventTurn<K extends string>(
  taskId: string,
  turn: EventTurn<K>,
  options: { ifClosed: "leave" },
): Promise<EventDelivery<"leave">>;
export async function deliverEventTurn<K extends string>(
  taskId: string,
  turn: EventTurn<K>,
  options: { ifClosed: IfClosed },
): Promise<EventDelivery> {
  const conversation = await latestAgentConversation(db, taskId);
  if (conversation === null) return { kind: "no-agent" };
  const closed = conversation.status === "done";
  if (closed && options.ifClosed === "leave")
    return { kind: "finished", conversationId: conversation.id };
  const stopped = conversation.status === "gone";
  if (closed || stopped) {
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
    was: closed ? "closed" : stopped ? "stopped" : "running",
  };
}
