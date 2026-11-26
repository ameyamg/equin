import { eq, inArray } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { isAgentBusy, QUESTION_WAITING_FOR } from "@plugins/conversations/core";
import type { ConversationStatus } from "@plugins/tasks/plugins/tasks-core/core";
import {
  _attempts,
  _conversations,
} from "@plugins/tasks/plugins/tasks-core/server";
import { TreeDigest } from "@plugins/tasks/plugins/orchestration/plugins/tree-digest/server";
import { latestPersonTurnAt } from "@plugins/conversations/plugins/turn-ledger/server";
import { latestAnswerAt } from "@plugins/conversations/plugins/question-relay/server";
import type { TurnAddressee } from "../../core";
import {
  _taskOutcomeReportsExt,
  _turnAddressees,
} from "../../server/internal/tables";
import { latest } from "./run-state";

const MAX = 120;

/** A report's first sentence, as one digest word: markdown emphasis and
 * headings dropped, cut at the first sentence end or line, capped. */
export function firstSentence(body: string): string {
  const line =
    body
      .split("\n")
      .map((l) =>
        l
          .replace(/^#+\s*/, "")
          .replace(/[*_`]/g, "")
          .trim(),
      )
      .find((l) => l !== "") ?? "";
  const end = line.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? line : line.slice(0, end + 1);
  return sentence.length > MAX ? `${sentence.slice(0, MAX - 1)}…` : sentence;
}

export const ASKING_USER = "asking the user";
export const WAITING_ON_USER = "waiting on the user";

/** One task's latest conversation, with its recorded `turn_for` if any. */
export interface RestingCandidate {
  status: ConversationStatus;
  waitingFor: string | null;
  /** Its `turn_for` row: whom its last declared turn was for, and when. */
  declared: {
    to: TurnAddressee;
    awaiting: string | null;
    declaredAt: Date;
  } | null;
  /** The user's latest word to it (a turn, an answer), null: never. */
  userSpokeAt: Date | null;
}

/**
 * Whether a task's agent rests on the user — what tells a supervisor "the
 * user is mid-conversation" apart from "the work is done, close it" when its
 * subtree goes quiet:
 * - `asking the user` — waiting on its AskUserQuestion;
 * - `waiting on the user: <awaiting>` — at rest, its latest `turn_for` said
 *   `user` (naming what it waits for), and the user has not spoken since;
 * - null otherwise: busy, closed, held on a turn it has not started, handed
 *   back or about to be (`supervisor`), or stopped without declaring.
 * Read from the recorded declaration (the hand-back marks it used, never
 * deletes it), not inferred from "not handed back yet".
 */
export function restingOnUser(c: RestingCandidate): string | null {
  if (isAgentBusy(c.status) || c.status === "done") return null;
  if (c.waitingFor === QUESTION_WAITING_FOR) return ASKING_USER;
  if (c.waitingFor !== null) return null;
  const d = c.declared;
  if (d === null || d.to !== "user") return null;
  if (c.userSpokeAt !== null && c.userSpokeAt > d.declaredAt) return null;
  return d.awaiting === null || d.awaiting === ""
    ? WAITING_ON_USER
    : `${WAITING_ON_USER}: ${firstSentence(d.awaiting)}`;
}

async function restingWords(
  taskIds: readonly string[],
): Promise<Map<string, string>> {
  const rows = await db
    .select({
      id: _conversations.id,
      taskId: _attempts.taskId,
      status: _conversations.status,
      waitingFor: _conversations.waitingFor,
      createdAt: _conversations.createdAt,
      to: _turnAddressees.to,
      awaiting: _turnAddressees.awaiting,
      declaredAt: _turnAddressees.declaredAt,
    })
    .from(_conversations)
    .innerJoin(_attempts, eq(_attempts.id, _conversations.attemptId))
    .leftJoin(
      _turnAddressees,
      eq(_turnAddressees.conversationId, _conversations.id),
    )
    .where(inArray(_attempts.taskId, [...taskIds]));
  // A task's agent is its latest conversation, whatever its status: an
  // older one left open (gone, never closed) is not what the task waits on.
  const latestByTask = new Map<string, (typeof rows)[number]>();
  for (const c of rows) {
    const seen = latestByTask.get(c.taskId);
    if (seen === undefined || c.createdAt > seen.createdAt)
      latestByTask.set(c.taskId, c);
  }
  // Only a question, or a `user` declaration, can rest on the user; the
  // user's latest word is read for those alone.
  const candidates = [...latestByTask.values()].filter(
    (c) =>
      !isAgentBusy(c.status) &&
      c.status !== "done" &&
      (c.waitingFor === QUESTION_WAITING_FOR ||
        (c.waitingFor === null && c.to === "user")),
  );
  const out = new Map<string, string>();
  await Promise.all(
    candidates.map(async (c) => {
      const [turnAt, answerAt] = await Promise.all([
        latestPersonTurnAt(c.id),
        latestAnswerAt(c.id),
      ]);
      const word = restingOnUser({
        status: c.status,
        waitingFor: c.waitingFor,
        declared:
          c.to === null || c.declaredAt === null
            ? null
            : { to: c.to, awaiting: c.awaiting, declaredAt: c.declaredAt },
        userSpokeAt: latest(turnAt, answerAt),
      });
      if (word !== null) out.set(c.taskId, word);
    }),
  );
  return out;
}

/** On every digested task: `report: <first sentence>` when it has a report,
 * and `waiting on the user: …` / `asking the user` when its agent rests on
 * the user ({@link restingOnUser}). */
export const outcomeReportDigestAnnotation = TreeDigest.Annotation({
  id: "outcome-report",
  async annotate(tasks) {
    if (tasks.length === 0) return new Map();
    const ids = tasks.map((t) => t.id);
    const [rows, resting] = await Promise.all([
      db
        .select({
          taskId: _taskOutcomeReportsExt.taskId,
          body: _taskOutcomeReportsExt.body,
        })
        .from(_taskOutcomeReportsExt)
        .where(inArray(_taskOutcomeReportsExt.taskId, ids)),
      restingWords(ids),
    ]);
    const out = new Map<string, string[]>();
    for (const r of rows)
      out.set(r.taskId, [`report: ${firstSentence(r.body)}`]);
    for (const [taskId, word] of resting)
      out.set(taskId, [word, ...(out.get(taskId) ?? [])]);
    return out;
  },
});
