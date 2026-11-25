import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "@plugins/database/server";
import { sha256Hex } from "@plugins/packages/plugins/string-hash/core";
import {
  turnIdKind,
  type TurnId,
} from "@plugins/conversations/plugins/turn-ledger/core";
import type {
  EventDelivery,
  EventTurn,
} from "@plugins/tasks/plugins/orchestration/plugins/message/server";
import {
  decisionExchangeIdKind,
  decisionIdKind,
  EXCHANGES_PER_DECISION_MAX,
  type AnswerRefusalReason,
  type DecisionAnswer,
  type DecisionId,
  type SubmitAnswersBody,
  type SubmitAnswersResponse,
} from "../../core";
import { _decisionExchanges, _decisions } from "../../server/internal/tables";

// The user's batch of answers (`POST /api/decisions/answers`), as a function
// over an executor and ports — the endpoint runs it on the app's db, delivering
// through `deliverEventTurn`; the tests on a throwaway database with a fake
// agent. Each agent gets ONE event turn naming all of its answers, its
// exchanges written in the transaction that records the turn; an agent that
// has finished is never reopened — its answers are kept on the record.

/** What delivering does outside the record. */
export interface AnswerPorts {
  /** Whether `taskId`'s agent has finished (its latest conversation is `done`). */
  isFinished(taskId: string): Promise<boolean>;
  /** Type one event turn into `taskId`'s agent (`deliverEventTurn`). */
  deliver(taskId: string, turn: EventTurn): Promise<EventDelivery>;
  /** A decision's record changed (closed): record its version. */
  recordVersion(decisionId: DecisionId): Promise<void>;
  /**
   * Take the note the user wrote on a decision (in the prompt field, so it
   * may reference attachments): keep what it attached with the decision and
   * answer the note as its agent reads it.
   */
  takeNote(decisionId: DecisionId, note: string): Promise<string>;
}

/** Whether the exchanges of `turnId` committed (its turn was recorded). */
async function turnRecorded(
  exec: DbExecutor,
  turnId: TurnId,
): Promise<boolean> {
  const [row] = await exec
    .select({ id: _decisionExchanges.id })
    .from(_decisionExchanges)
    .where(eq(_decisionExchanges.turnId, turnId))
    .limit(1);
  return row !== undefined;
}

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

type Refused = SubmitAnswersResponse["refused"][number];

interface Target {
  id: DecisionId;
  taskId: string;
  label: string;
  state: string;
  optionKeys: readonly string[];
}

/** An answer checked against its decision: what it does. */
export interface Checked {
  target: Target;
  pick: string | null;
  /** The note, trimmed; `null` when none. */
  note: string | null;
  close: boolean;
}

/** One answer refused before anything was written. */
class AnswerConflict extends Error {
  constructor(
    readonly decision: DecisionId,
    readonly reason: AnswerRefusalReason,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The ledger id of one agent's turn for one Submit: derived from the
 * submission, the task and what it says, so a retried request names the same
 * turn and the ledger records it once (its exchanges with it).
 */
export function answerTurnId(
  submissionId: string,
  taskId: string,
  answers: readonly Checked[],
): TurnId {
  // What the turn says is part of its id: a resend of the same request is
  // the same turn, a turn saying anything else is another one.
  const content = answers
    .map((a) => JSON.stringify([a.target.id, a.pick, a.note]))
    .join("\n");
  const h = sha256Hex(`decisions.answers:${submissionId}:${taskId}:${content}`);
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  return turnIdKind.parse(`turn-${uuid}`);
}

const escapeText = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapeAttr = (s: string): string =>
  escapeText(s).replaceAll('"', "&quot;");

/**
 * The event turn one agent reads: every answer and question of the batch that
 * is its, each note as the agent reads it (`agentNotes`, from `takeNote`:
 * attachment refs as disk paths).
 */
export function answerTurnText(
  answers: readonly Checked[],
  agentNotes: ReadonlyMap<DecisionId, string>,
): string {
  const picks = answers.filter((a) => a.pick !== null).length;
  const questions = answers.length - picks;
  const head =
    questions === 0
      ? `The user answered ${answers.length === 1 ? "1 of your decisions" : `${answers.length} of your decisions`}:`
      : picks === 0
        ? `The user asked about ${answers.length === 1 ? "1 of your decisions" : `${answers.length} of your decisions`}:`
        : `The user answered ${picks} and asked about ${questions} of your decisions:`;
  const lines = answers.map((a) => {
    let note: string | null = null;
    if (a.note !== null) {
      note = agentNotes.get(a.target.id) ?? null;
      if (note === null)
        throw new Error(
          `decisions.answers: ${a.target.id}'s note was never taken`,
        );
    }
    const attrs = `decision="${a.target.id}" label="${escapeAttr(a.target.label)}"`;
    if (a.pick !== null) {
      const open = `<decision-answer ${attrs} pick="${escapeAttr(a.pick)}"`;
      return note === null
        ? `${open}/>`
        : `${open}>${escapeText(note)}</decision-answer>`;
    }
    return `<decision-question ${attrs}>${escapeText(note ?? "")}</decision-question>`;
  });
  const how: string[] = [];
  if (picks > 0)
    how.push(
      'Act on each answer, then close it with update_decision({ decision, state: "closed", outcome }) — or update it if it needs the user again.',
    );
  if (questions > 0)
    how.push("Answer each question with update_decision({ decision, reply }).");
  return `${head}\n\n${lines.join("\n")}\n\n${how.join(" ")}`;
}

const refusal = (
  decision: string,
  reason: AnswerRefusalReason,
  message: string,
): Refused => ({ decision, reason, message });

/** Check each answer against its decision; what cannot be taken is refused with its reason. */
async function checkAnswers(
  exec: DbExecutor,
  answers: readonly DecisionAnswer[],
): Promise<{ checked: Checked[]; refused: Refused[] }> {
  const ids = answers
    .map((a) => a.decision)
    .filter((id): id is DecisionId => decisionIdKind.is(id));
  const rows =
    ids.length === 0
      ? []
      : await exec
          .select({
            id: _decisions.id,
            taskId: _decisions.taskId,
            label: _decisions.label,
            state: _decisions.state,
            options: _decisions.options,
          })
          .from(_decisions)
          .where(inArray(_decisions.id, ids));
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const checked: Checked[] = [];
  const refused: Refused[] = [];
  for (const a of answers) {
    const row = byId.get(a.decision);
    if (row === undefined) {
      refused.push(
        refusal(
          a.decision,
          "unknown-decision",
          "This decision no longer exists.",
        ),
      );
      continue;
    }
    if (row.state === "closed") {
      refused.push(
        refusal(a.decision, "closed", `${row.label} was closed meanwhile.`),
      );
      continue;
    }
    const note = a.note?.trim() ?? "";
    const pick = a.pick ?? null;
    if (pick === null && note === "" && a.close !== true) {
      refused.push(refusal(a.decision, "empty", "Nothing to send."));
      continue;
    }
    if (pick !== null && !row.options.some((o) => o.key === pick)) {
      refused.push(
        refusal(
          a.decision,
          "unknown-pick",
          `${row.label} no longer offers option ${pick}: its options changed.`,
        ),
      );
      continue;
    }
    checked.push({
      target: {
        id: row.id,
        taskId: row.taskId,
        label: row.label,
        state: row.state,
        optionKeys: row.options.map((o) => o.key),
      },
      pick,
      note: note === "" ? null : note,
      close: a.close === true,
    });
  }
  return { checked, refused };
}

/**
 * Lock a decision for the write and refuse it when it closed or its thread is
 * full — and, for an answer about to be SENT, when the agent already holds
 * one it has not acted on (Sent), or the same question waits for a reply: a
 * second Submit of one draft (another tab, a double ⌘↵) sends nothing twice.
 */
async function lockOpen(
  exec: DbExecutor,
  target: Target,
  sending?: { pick: string | null; note: string | null },
): Promise<void> {
  const [row] = await exec
    .select({ state: _decisions.state })
    .from(_decisions)
    .where(eq(_decisions.id, target.id))
    .for("update");
  if (row === undefined)
    throw new AnswerConflict(
      target.id,
      "unknown-decision",
      "This decision no longer exists.",
    );
  if (row.state === "closed")
    throw new AnswerConflict(
      target.id,
      "closed",
      `${target.label} was closed meanwhile.`,
    );
  const [count] = await exec
    .select({ n: sql`count(*)::int`.mapWith(Number) })
    .from(_decisionExchanges)
    .where(eq(_decisionExchanges.decisionId, target.id));
  if (sending !== undefined) {
    const [dup] = await exec
      .select({ kind: _decisionExchanges.kind })
      .from(_decisionExchanges)
      .where(
        and(
          eq(_decisionExchanges.decisionId, target.id),
          sql`((${_decisionExchanges.kind} = 'answer' AND ${_decisionExchanges.consumedAt} IS NULL)
            OR (${_decisionExchanges.kind} = 'question' AND ${_decisionExchanges.agentText} IS NULL
                AND ${sending.pick === null} AND ${_decisionExchanges.userText} = ${sending.note ?? ""}))`,
        ),
      )
      .limit(1);
    if (dup !== undefined)
      throw new AnswerConflict(
        target.id,
        "already-sent",
        dup.kind === "answer"
          ? `${target.label} already holds an answer its agent has not acted on yet.`
          : `${target.label}'s agent already has this question and has not replied yet.`,
      );
  }
  if ((count?.n ?? 0) >= EXCHANGES_PER_DECISION_MAX)
    throw new AnswerConflict(
      target.id,
      "too-many-exchanges",
      `${target.label}'s thread is full (${EXCHANGES_PER_DECISION_MAX} exchanges): ask its agent to carry on in a new decision.`,
    );
}

/** The outcome a decision closes with when nothing is sent. */
function closingOutcome(a: Checked, finished: boolean): string | null {
  if (a.pick !== null)
    return finished
      ? `You chose ${a.pick} (not sent: the agent had finished)`
      : null;
  if (!a.close) return null;
  if (a.target.state === "fyi") return "Seen";
  return "Closed by you (the agent had finished)";
}

/**
 * Keep answers on the record without delivering them — an agent that has
 * finished, or an FYI the user closed ("Got it"). A pick closes the decision
 * with "You chose A (not sent …)", a close settles it; a note alone stays
 * open, kept as `recorded`. Returns the decisions it closed.
 */
async function recordAnswers(
  exec: DbExecutor,
  answers: readonly Checked[],
  finished: boolean,
): Promise<DecisionId[]> {
  const closed: DecisionId[] = [];
  for (const a of answers) {
    await lockOpen(exec, a.target);
    if (a.pick !== null || a.note !== null)
      await exec.insert(_decisionExchanges).values({
        id: decisionExchangeIdKind.mint(),
        decisionId: a.target.id,
        kind: "recorded",
        pick: a.pick,
        userText: a.note,
        agentText: null,
        agentAt: null,
        turnId: null,
        consumedAt: null,
      });
    const outcome = closingOutcome(a, finished);
    if (outcome !== null) {
      await exec
        .update(_decisions)
        .set({
          state: "closed",
          stateLabel: null,
          outcome,
          closedAt: sql`now()`,
        })
        .where(
          and(
            eq(_decisions.id, a.target.id),
            sql`${_decisions.state} <> 'closed'`,
          ),
        );
      closed.push(a.target.id);
    }
  }
  return closed;
}

/** Write a delivered turn's exchanges, on the transaction that records the turn. */
async function writeDelivered(
  exec: DbExecutor,
  answers: readonly Checked[],
  turnId: TurnId,
): Promise<void> {
  for (const a of answers) {
    await lockOpen(exec, a.target, { pick: a.pick, note: a.note });
    await exec.insert(_decisionExchanges).values({
      id: decisionExchangeIdKind.mint(),
      decisionId: a.target.id,
      kind: a.pick !== null ? "answer" : "question",
      pick: a.pick,
      userText: a.note,
      agentText: null,
      agentAt: null,
      turnId,
      consumedAt: null,
    });
  }
}

function groupByTask(answers: readonly Checked[]): Map<string, Checked[]> {
  const out = new Map<string, Checked[]>();
  for (const a of answers) {
    const list = out.get(a.target.taskId);
    if (list === undefined) out.set(a.target.taskId, [a]);
    else list.push(a);
  }
  return out;
}

/**
 * Submit a batch of answers. Per agent (task):
 *
 * - finished (its latest conversation `done`): every answer kept on the
 *   record (`recordAnswers`), nothing delivered, the agent not reopened;
 * - otherwise "Got it" on an FYI is recorded (nothing to tell the agent), a
 *   close of anything else refused, and every pick and question goes in ONE
 *   event turn whose exchanges commit with it (a conflict found there —
 *   closed meanwhile, a full thread — rolls the turn back and refuses that
 *   agent's answers).
 *
 * A duplicate decision in one batch is a broken client: it throws.
 */
export async function submitAnswers(
  db: DbExecutor,
  body: SubmitAnswersBody,
  ports: AnswerPorts,
): Promise<SubmitAnswersResponse> {
  const seen = new Set<string>();
  for (const a of body.answers) {
    if (seen.has(a.decision))
      throw new Error(
        `decisions.answers: ${a.decision} answered twice in one batch`,
      );
    seen.add(a.decision);
  }
  const { checked, refused } = await checkAnswers(db, body.answers);
  // Every note taken first — delivered or only kept, the thread shows it, so
  // what it attached stays with the decision either way.
  const agentNotes = new Map<DecisionId, string>();
  for (const a of checked)
    if (a.note !== null)
      agentNotes.set(a.target.id, await ports.takeNote(a.target.id, a.note));
  const delivered: SubmitAnswersResponse["delivered"] = [];
  const recorded: string[] = [];

  const keep = async (answers: readonly Checked[], finished: boolean) => {
    if (answers.length === 0) return;
    try {
      const closed = await db.transaction((tx) =>
        recordAnswers(tx, answers, finished),
      );
      recorded.push(...answers.map((a) => a.target.id));
      for (const id of closed) await ports.recordVersion(id);
    } catch (err) {
      if (!(err instanceof AnswerConflict)) throw err;
      refused.push(refusal(err.decision, err.reason, err.message));
      // The others of this agent's batch are taken again without it.
      await keep(
        answers.filter((a) => a.target.id !== err.decision),
        finished,
      );
    }
  };

  for (const [taskId, answers] of groupByTask(checked)) {
    if (await ports.isFinished(taskId)) {
      await keep(answers, true);
      continue;
    }
    const closes = answers.filter((a) => a.close && a.pick === null);
    const toSend = answers.filter((a) => !(a.close && a.pick === null));
    for (const a of closes) {
      if (a.target.state !== "fyi")
        refused.push(
          refusal(
            a.target.id,
            "close-not-allowed",
            `${a.target.label}'s agent is still running: answer it instead of closing it.`,
          ),
        );
    }
    await keep(
      closes.filter((a) => a.target.state === "fyi"),
      false,
    );
    let sending = toSend;
    while (sending.length > 0) {
      const batch = sending;
      const turnId = answerTurnId(body.submissionId, taskId, batch);
      let outcome: EventDelivery;
      try {
        outcome = await ports.deliver(taskId, {
          id: turnId,
          text: answerTurnText(batch, agentNotes),
          onRecorded: (tx) => writeDelivered(tx, batch, turnId),
        });
      } catch (err) {
        if (err instanceof AnswerConflict) {
          refused.push(refusal(err.decision, err.reason, err.message));
          sending = batch.filter((a) => a.target.id !== err.decision);
          continue;
        }
        // Typing failed. Recorded (the exchanges committed with the ledger
        // row, now `failed`): delivered, said so — the turn is retried from
        // the conversation. Not recorded: nothing happened, refused. Either
        // way the other agents of the batch still get theirs.
        if (await turnRecorded(db, turnId))
          delivered.push({
            taskId,
            conversationId: null,
            turnId,
            decisions: batch.map((a) => a.target.id),
            typingFailed: errorText(err),
          });
        else
          for (const a of batch)
            refused.push(
              refusal(
                a.target.id,
                "delivery-failed",
                `Could not reach its agent: ${errorText(err)}`,
              ),
            );
        sending = [];
        continue;
      }
      switch (outcome.kind) {
        case "delivered":
          delivered.push({
            taskId,
            conversationId: outcome.conversationId,
            turnId: outcome.turnId,
            decisions: batch.map((a) => a.target.id),
            typingFailed: null,
          });
          break;
        case "finished":
          // It closed between the check and the delivery: kept, as above.
          await keep(batch, true);
          break;
        case "no-agent":
          for (const a of batch)
            refused.push(
              refusal(
                a.target.id,
                "no-agent",
                "No agent ran on this decision's task.",
              ),
            );
          break;
        case "resume-blocked":
          for (const a of batch)
            refused.push(
              refusal(
                a.target.id,
                "resume-blocked",
                `Its agent is stopped and cannot be resumed: ${outcome.message}`,
              ),
            );
          break;
      }
      sending = [];
    }
  }
  return { delivered, recorded, refused };
}
