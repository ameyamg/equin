import { eq } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { latestPersonTurnAt } from "@plugins/conversations/plugins/turn-ledger/server";
import { latestAnswerAt } from "@plugins/conversations/plugins/question-relay/server";
import type { TurnAddressee } from "../../core";
import {
  _turnAddressees,
  taskOutcomeReports,
} from "../../server/internal/tables";

/**
 * Where one conversation's run stands, as the stop gate and the hand-back
 * read it:
 * - `userSpokeAt` — the user's latest word to it: a turn they sent, or an
 *   answer to one of its questions (null: never);
 * - `handedBackAt` — when this conversation last handed its run back (its
 *   task's report, when this conversation wrote it);
 * - `addressee` — whom the agent said its turn is for, counted only when it
 *   said so after the user's latest word; `declaredAt` identifies that
 *   declaration, so the turn it was for can use it up.
 */
export interface RunState {
  userSpokeAt: Date | null;
  handedBackAt: Date | null;
  addressee: TurnAddressee | null;
  declaredAt?: Date;
}

/** The user has talked to the agent since its run was last handed back:
 * its turns are then for whomever the agent says. */
export function userInRun(state: RunState): boolean {
  if (state.userSpokeAt === null) return false;
  return state.handedBackAt === null || state.userSpokeAt > state.handedBackAt;
}

/**
 * What a turn's end means for the run (the table in the plugin's CLAUDE.md):
 * - the user is in the run → handed back only when the agent said
 *   `supervisor`; otherwise the reply is theirs;
 * - nobody but its starter is → handed back, unless the agent will be woken
 *   anyway (background work, a watched subtree still running): a pause, not
 *   the end.
 */
export function runEnd(
  state: RunState,
  wakeReasons: readonly string[],
): "hand-back" | "none" {
  if (userInRun(state))
    return state.addressee === "supervisor" ? "hand-back" : "none";
  return wakeReasons.length > 0 ? "none" : "hand-back";
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/**
 * The run's state now, or — `asOf`, a turn's end — as it stood when that turn
 * ended: a word the user sent after it, or a declaration made after it, is
 * the next turn's, not this one's.
 */
export async function readRunState(
  conversation: { id: string; taskId: string },
  asOf?: Date,
): Promise<RunState> {
  const [turnAt, answerAt, report, [declared]] = await Promise.all([
    latestPersonTurnAt(conversation.id, asOf),
    latestAnswerAt(conversation.id, asOf),
    taskOutcomeReports.get(conversation.taskId),
    db
      .select()
      .from(_turnAddressees)
      .where(eq(_turnAddressees.conversationId, conversation.id)),
  ]);
  const userSpokeAt = latest(turnAt, answerAt);
  const handedBackAt =
    report?.conversationId === conversation.id
      ? new Date(report.submittedAt)
      : null;
  const counts =
    declared !== undefined &&
    (userSpokeAt === null || declared.declaredAt > userSpokeAt) &&
    (asOf === undefined || declared.declaredAt <= asOf);
  return counts
    ? {
        userSpokeAt,
        handedBackAt,
        addressee: declared.to,
        declaredAt: declared.declaredAt,
      }
    : { userSpokeAt, handedBackAt, addressee: null };
}
