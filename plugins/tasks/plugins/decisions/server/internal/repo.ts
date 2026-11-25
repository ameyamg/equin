import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@plugins/database/server";
import type {
  ConversationId,
  TaskId,
} from "@plugins/tasks/plugins/task-ids/core";
import { executeRows } from "@plugins/database/plugins/sql-rows/core";
import {
  DECISION_TABS,
  decisionExchangeIdKind,
  decisionIdKind,
  DECISIONS_PER_TASK_MAX,
  DECISION_STATES,
  EXCHANGES_PER_DECISION_MAX,
  type DecisionId,
  type DecisionOption,
  type DecisionState,
  type DecisionTab,
  type OpenDecisionState,
} from "../../core";
import { decisionTabSql } from "./facts";
import { _decisionExchangeFacts } from "./rollup-table";
import { _decisionExchanges, _decisions } from "./tables";

// The decisions record's writes and reads, over an executor: the MCP tools
// (`./tools.ts`) run them in a transaction, the tests inside a rolled-back
// one. Every refusal is a discriminated result naming what to do instead,
// never a silent no-op.

/** Who is calling: the conversation, and the task it belongs to (the owner of what it opens). */
export interface DecisionCaller {
  taskId: TaskId;
  conversationId: ConversationId;
}

/** A `count(*)` read: Postgres always answers one row. */
const countSql = sql`count(*)::int`.mapWith(Number);
function countOf(rows: readonly { n: number }[]): number {
  const [row] = rows;
  if (row === undefined) throw new Error("decisions: count(*) returned no row");
  return row.n;
}

/** An option as an agent writes it. */
export interface OptionInput {
  key: string;
  text: string;
  recommended?: boolean;
}

export type DecisionRefusalReason =
  | "unknown-decision"
  | "not-yours"
  | "unknown-from"
  | "too-many-decisions"
  | "too-many-exchanges"
  | "label-invalid"
  | "label-taken"
  | "state-label"
  | "options-invalid"
  | "close-needs-outcome"
  | "outcome-without-close"
  | "closed-edit"
  | "no-pending-question"
  | "nothing-to-update"
  | "edit-invalid"
  | "edit-no-match"
  | "edit-ambiguous"
  | "edit-conflict";

export interface DecisionRefusal {
  ok: false;
  reason: DecisionRefusalReason;
  message: string;
}

const refuse = (
  reason: DecisionRefusalReason,
  message: string,
): DecisionRefusal => ({ ok: false, reason, message });

type DecisionRecord = typeof _decisions.$inferSelect;

/** A label: what an agent calls a decision in its task ("D22", "D17a"). */
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const AUTO_LABEL_RE = /^D(\d{1,15})$/;

function checkLabel(label: string): DecisionRefusal | null {
  if (!LABEL_RE.test(label))
    return refuse(
      "label-invalid",
      `"${label}" is not a label: 1–32 letters, digits, ".", "_" or "-", starting with a letter or digit.`,
    );
  if (decisionIdKind.is(label))
    return refuse(
      "label-invalid",
      `"${label}" reads as a decision id; pick a label that does not (e.g. "D3").`,
    );
  return null;
}

function checkOptions(
  options: readonly OptionInput[],
): DecisionRefusal | DecisionOption[] {
  const keys = new Set<string>();
  let recommended = 0;
  for (const o of options) {
    if (keys.has(o.key))
      return refuse(
        "options-invalid",
        `Two options share the key "${o.key}"; keys are unique.`,
      );
    keys.add(o.key);
    if (/[\r\n]/.test(o.text))
      return refuse(
        "options-invalid",
        `Option ${o.key} spans several lines; an option is ONE sentence — put the detail in \`body\`.`,
      );
    if (o.recommended === true) recommended++;
  }
  if (recommended > 1)
    return refuse(
      "options-invalid",
      "More than one option is `recommended`; recommend at most one.",
    );
  return options.map((o) => ({
    key: o.key,
    text: o.text,
    recommended: o.recommended === true,
  }));
}

/** Serialize this task's label writes (auto-numbering, the per-task cap). */
async function lockTask(exec: DbExecutor, taskId: string): Promise<void> {
  await exec.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`decisions:${taskId}`}))`,
  );
}

/** The next free `D<n>` of a task: one past the highest it holds (past any taken one, whatever its shape). */
export async function nextLabel(
  exec: DbExecutor,
  taskId: TaskId,
): Promise<string> {
  const rows = await exec
    .select({ label: _decisions.label })
    .from(_decisions)
    .where(eq(_decisions.taskId, taskId));
  let max = 0;
  for (const { label } of rows) {
    const m = AUTO_LABEL_RE.exec(label);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const taken = new Set(rows.map((r) => r.label));
  let n = max + 1;
  while (taken.has(`D${n}`)) n++;
  return `D${n}`;
}

async function byId(
  exec: DbExecutor,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<DecisionRecord | null> {
  const q = exec
    .select()
    .from(_decisions)
    .where(eq(_decisions.id, decisionIdKind.key(id)));
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  return row ?? null;
}

async function byLabel(
  exec: DbExecutor,
  taskId: TaskId,
  label: string,
  opts: { forUpdate?: boolean } = {},
): Promise<DecisionRecord | null> {
  const q = exec
    .select()
    .from(_decisions)
    .where(and(eq(_decisions.taskId, taskId), eq(_decisions.label, label)));
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  return row ?? null;
}

/**
 * The decision `ref` names — an id (any task) or a label of the caller's
 * task. `unknown` when it names nothing.
 */
async function resolve(
  exec: DbExecutor,
  caller: DecisionCaller,
  ref: string,
  opts: { forUpdate?: boolean } = {},
): Promise<DecisionRecord | null> {
  const trimmed = ref.trim();
  if (decisionIdKind.is(trimmed)) return byId(exec, trimmed, opts);
  return byLabel(exec, caller.taskId, trimmed, opts);
}

export interface OpenDecisionInput {
  label?: string;
  state: OpenDecisionState;
  stateLabel?: string;
  question: string;
  body?: string;
  options?: readonly OptionInput[];
  /** The decision this one comes from: an id (any task) or a label of the caller's task. */
  from?: string;
}

export type OpenDecisionResult =
  { ok: true; id: DecisionId; label: string } | DecisionRefusal;

/** `open_decision`: a new decision of the caller's task. */
export async function openDecision(
  exec: DbExecutor,
  caller: DecisionCaller,
  input: OpenDecisionInput,
): Promise<OpenDecisionResult> {
  await lockTask(exec, caller.taskId);
  const n = countOf(
    await exec
      .select({ n: countSql })
      .from(_decisions)
      .where(eq(_decisions.taskId, caller.taskId)),
  );
  if (n >= DECISIONS_PER_TASK_MAX)
    return refuse(
      "too-many-decisions",
      `Your task already holds ${DECISIONS_PER_TASK_MAX} decisions, the most one task keeps. Close and settle what you can, or carry on in a new task.`,
    );
  const stateLabel = checkStateLabel(input.state, input.stateLabel ?? null);
  if (typeof stateLabel !== "string" && stateLabel !== null) return stateLabel;
  const options = checkOptions(input.options ?? []);
  if (!Array.isArray(options)) return options;

  let label: string;
  if (input.label === undefined) {
    label = await nextLabel(exec, caller.taskId);
  } else {
    label = input.label.trim();
    const bad = checkLabel(label);
    if (bad) return bad;
    if (await byLabel(exec, caller.taskId, label))
      return refuse(
        "label-taken",
        `Your task already has a decision labelled ${label}; pick another label, or leave it out for the next D<n>.`,
      );
  }

  let fromDecisionId: DecisionId | null = null;
  if (input.from !== undefined) {
    const from = await resolve(exec, caller, input.from);
    if (from === null)
      return refuse(
        "unknown-from",
        `\`from\`: ${input.from} names no decision (an id, or a label of your own task).`,
      );
    fromDecisionId = from.id;
  }

  const id = decisionIdKind.mint();
  await exec.insert(_decisions).values({
    id,
    taskId: caller.taskId,
    openedByConversationId: caller.conversationId,
    label,
    state: input.state,
    stateLabel,
    question: input.question,
    body: input.body ?? "",
    options,
    fromDecisionId,
    outcome: null,
    closedAt: null,
    seenAt: null,
  });
  return { ok: true, id, label };
}

/** `stateLabel` is required exactly when the state is `other`. Returns the label to store, or a refusal. */
function checkStateLabel(
  state: DecisionState,
  stateLabel: string | null,
): string | null | DecisionRefusal {
  if (state === "other") {
    if (stateLabel === null || stateLabel.trim() === "")
      return refuse(
        "state-label",
        'A decision in state `other` needs a `stateLabel` — your word for it ("Watching").',
      );
    return stateLabel.trim();
  }
  if (stateLabel !== null)
    return refuse(
      "state-label",
      `\`stateLabel\` names an \`other\` state only; this decision is \`${state}\`.`,
    );
  return null;
}

/**
 * One targeted edit of a decision's text — `old_string` replaced by
 * `new_string`, the way `Edit` replaces a string in a file: it must occur
 * exactly once in the field unless `replace_all`.
 */
export interface TextEdit {
  field: "question" | "body" | "option";
  /** The option's key, with `field: "option"` only (its text is edited). */
  option?: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

/** The longest a question, a body and an option's text may be (the tools' schemas say the same). */
export const QUESTION_MAX = 300;
export const BODY_MAX = 20_000;
export const OPTION_TEXT_MAX = 240;

export interface UpdateDecisionInput {
  /** An id or a label of the caller's task. */
  decision: string;
  /** Targeted edits of the question, the body and the options' text, applied in order, all or none. */
  edits?: readonly TextEdit[];
  question?: string;
  body?: string;
  options?: readonly OptionInput[];
  state?: DecisionState;
  stateLabel?: string;
  label?: string;
  /** Required when `state` becomes `closed`; refused otherwise. */
  outcome?: string;
  /** Answers the user's oldest question the agent has not replied to. */
  reply?: string;
  /** A note in the thread, on an open or a closed decision. */
  update?: string;
}

/** The fields that edit the decision itself — refused on a closed one unless the call reopens it. */
const EDIT_FIELDS = [
  "edits",
  "question",
  "body",
  "options",
  "state",
  "stateLabel",
  "label",
  "outcome",
] as const satisfies readonly (keyof UpdateDecisionInput)[];

export type UpdateDecisionResult =
  | {
      ok: true;
      id: DecisionId;
      label: string;
      state: DecisionState;
      /** Whether the call closed or reopened it. */
      transition: "closed" | "reopened" | null;
      /** What the call consumed: answers it now acts on, and whether `reply` answered a question. */
      consumed: { answers: number; question: boolean };
    }
  | DecisionRefusal;

/**
 * `update_decision`: patch a decision of the caller's task (absent =
 * unchanged), reply to the user's question, add a note.
 *
 * - Only the owning task's conversations update it.
 * - A closed decision stays a record: `update` and `reply` are accepted, any
 *   other field is refused unless the same call sets a non-closed `state`,
 *   which reopens it (`closedAt` and `outcome` cleared — the old outcome is
 *   kept in its version history).
 * - Any update consumes the answers the user sent it (ends "Sent").
 */
export async function updateDecision(
  exec: DbExecutor,
  caller: DecisionCaller,
  input: UpdateDecisionInput,
  opts: { dryRun?: boolean } = {},
): Promise<UpdateDecisionResult> {
  // An empty `edits` edits nothing: it is not an edit of the decision.
  const edits = EDIT_FIELDS.filter((k) =>
    k === "edits" ? (input.edits?.length ?? 0) > 0 : input[k] !== undefined,
  );
  if (
    edits.length === 0 &&
    input.reply === undefined &&
    input.update === undefined
  )
    return refuse(
      "nothing-to-update",
      "Nothing to update: pass `edits` or a field to change, `reply`, or `update`.",
    );
  const row = await resolve(exec, caller, input.decision, { forUpdate: true });
  if (row === null)
    return refuse(
      "unknown-decision",
      `${input.decision} names no decision of your task (see \`list_decisions\`).`,
    );
  if (row.taskId !== caller.taskId)
    return refuse(
      "not-yours",
      `${row.label} (${row.id}) belongs to ${row.taskId}; only its own agent updates it. You can open one of yours with \`from: "${row.id}"\`.`,
    );

  const wasClosed = row.state === "closed";
  const reopening =
    wasClosed && input.state !== undefined && input.state !== "closed";
  if (wasClosed && edits.length > 0 && !reopening)
    return refuse(
      "closed-edit",
      `${row.label} is closed: its question, options and outcome stay as decided. Add a note with \`update\`, or reopen it by setting a non-closed \`state\` in the same call. Refused: ${edits.join(", ")}.`,
    );
  const text = applyTextEdits(row, input);
  if ("ok" in text) return text;
  const state = input.state ?? row.state;
  const closing = !wasClosed && state === "closed";
  if (closing && (input.outcome === undefined || input.outcome.trim() === ""))
    return refuse(
      "close-needs-outcome",
      `Closing ${row.label} needs an \`outcome\`: what was decided ("A: cache 10 s, purge on deploy").`,
    );
  if (input.outcome !== undefined && !closing)
    return refuse(
      "outcome-without-close",
      `\`outcome\` is set by closing a decision (\`state: "closed"\` in the same call); ${row.label} is not being closed.`,
    );
  let stateLabel: string | null = null;
  if (state !== "closed") {
    const proposed =
      input.stateLabel !== undefined
        ? input.stateLabel
        : state === "other"
          ? row.stateLabel
          : null;
    const checked = checkStateLabel(state, proposed);
    if (checked !== null && typeof checked !== "string") return checked;
    stateLabel = checked;
  } else if (input.stateLabel !== undefined) {
    return refuse(
      "state-label",
      "`stateLabel` names an `other` state only; this call closes the decision.",
    );
  }
  let options: DecisionOption[] | undefined;
  if (text.options !== undefined) {
    const checked = checkOptions(text.options);
    if (!Array.isArray(checked)) return checked;
    options = checked;
  }
  let label = row.label;
  if (input.label !== undefined && input.label.trim() !== row.label) {
    label = input.label.trim();
    const bad = checkLabel(label);
    if (bad) return bad;
    // As `openDecision`: a label is chosen under the task's lock.
    await lockTask(exec, caller.taskId);
    if (await byLabel(exec, caller.taskId, label))
      return refuse(
        "label-taken",
        `Your task already has a decision labelled ${label}.`,
      );
  }

  let questionId: string | null = null;
  if (input.reply !== undefined) {
    const [pending] = await exec
      .select({ id: _decisionExchanges.id })
      .from(_decisionExchanges)
      .where(
        and(
          eq(_decisionExchanges.decisionId, row.id),
          eq(_decisionExchanges.kind, "question"),
          isNull(_decisionExchanges.agentText),
        ),
      )
      .orderBy(asc(_decisionExchanges.createdAt), asc(_decisionExchanges.id))
      .limit(1);
    if (pending === undefined)
      return refuse(
        "no-pending-question",
        `${row.label} has no question from the user waiting for a reply. To add a note, use \`update\`.`,
      );
    questionId = pending.id;
  }
  if (input.update !== undefined) {
    const n = countOf(
      await exec
        .select({ n: countSql })
        .from(_decisionExchanges)
        .where(eq(_decisionExchanges.decisionId, row.id)),
    );
    if (n >= EXCHANGES_PER_DECISION_MAX)
      return refuse(
        "too-many-exchanges",
        `${row.label}'s thread holds ${EXCHANGES_PER_DECISION_MAX} exchanges, the most one keeps. Open a new decision with \`from: "${row.label}"\` and close this one.`,
      );
  }

  if (opts.dryRun === true)
    return {
      ok: true,
      id: row.id,
      label,
      state,
      transition: closing ? "closed" : reopening ? "reopened" : null,
      consumed: { answers: 0, question: questionId !== null },
    };

  if (edits.length > 0) {
    await exec
      .update(_decisions)
      .set({
        ...(text.question !== undefined ? { question: text.question } : {}),
        ...(text.body !== undefined ? { body: text.body } : {}),
        ...(options !== undefined ? { options } : {}),
        label,
        state,
        stateLabel,
        ...(closing
          ? { outcome: input.outcome!.trim(), closedAt: sql`now()` }
          : {}),
        ...(reopening ? { outcome: null, closedAt: null } : {}),
      })
      .where(eq(_decisions.id, row.id));
  }
  if (questionId !== null)
    await exec
      .update(_decisionExchanges)
      .set({ agentText: input.reply!, agentAt: sql`now()` })
      .where(eq(_decisionExchanges.id, decisionExchangeIdKind.key(questionId)));
  if (input.update !== undefined)
    await exec.insert(_decisionExchanges).values({
      id: decisionExchangeIdKind.mint(),
      decisionId: row.id,
      kind: "update",
      pick: null,
      userText: null,
      agentText: input.update,
      agentAt: sql`now()`,
      turnId: null,
      consumedAt: null,
    });
  const consumed = await exec
    .update(_decisionExchanges)
    .set({ consumedAt: sql`now()` })
    .where(
      and(
        eq(_decisionExchanges.decisionId, row.id),
        eq(_decisionExchanges.kind, "answer"),
        isNull(_decisionExchanges.consumedAt),
      ),
    )
    .returning({ id: _decisionExchanges.id });
  return {
    ok: true,
    id: row.id,
    label,
    state,
    transition: closing ? "closed" : reopening ? "reopened" : null,
    consumed: { answers: consumed.length, question: questionId !== null },
  };
}

/** The text a call leaves a decision with: a field it does not change is absent. */
interface EditedText {
  question?: string;
  body?: string;
  options?: readonly OptionInput[];
}

/** Where `needle` occurs in `hay`, up to two (enough to tell none, one and several apart). */
function occurrences(hay: string, needle: string): number {
  const first = hay.indexOf(needle);
  if (first === -1) return 0;
  return hay.indexOf(needle, first + needle.length) === -1 ? 1 : 2;
}

/**
 * The question, body and options a call leaves: its whole-field values, then
 * its `edits` applied in order over the current text — all or none. A field
 * both replaced whole and edited in one call is refused (which would win is
 * not what the caller meant to say).
 */
function applyTextEdits(
  row: DecisionRecord,
  input: UpdateDecisionInput,
): EditedText | DecisionRefusal {
  const out: EditedText = {
    ...(input.question !== undefined ? { question: input.question } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.options !== undefined ? { options: input.options } : {}),
  };
  const edits = input.edits ?? [];
  if (edits.length === 0) return out;
  let question = row.question;
  let body = row.body;
  const options: OptionInput[] = row.options.map((o) => ({ ...o }));
  for (const [i, e] of edits.entries()) {
    const where =
      e.field === "option" ? `option ${e.option ?? "?"}` : `the ${e.field}`;
    const n = `Edit ${i + 1} (${where})`;
    const whole = e.field === "option" ? input.options : input[e.field];
    if (whole !== undefined)
      return refuse(
        "edit-conflict",
        `${n}: this call also replaces ${e.field === "option" ? "`options`" : `\`${e.field}\``} whole. Pass either the whole field or edits of it, not both.`,
      );
    if (e.field === "option" && e.option === undefined)
      return refuse(
        "edit-invalid",
        `${n}: an option edit names the option's key in \`option\`.`,
      );
    if (e.field !== "option" && e.option !== undefined)
      return refuse(
        "edit-invalid",
        `${n}: \`option\` names an option's key, with \`field: "option"\` only.`,
      );
    if (e.old_string === "")
      return refuse(
        "edit-invalid",
        `${n}: \`old_string\` is empty; quote the text to replace.`,
      );
    if (e.old_string === e.new_string)
      return refuse(
        "edit-invalid",
        `${n}: \`old_string\` and \`new_string\` are the same; nothing would change.`,
      );
    const opt =
      e.field === "option" ? options.find((o) => o.key === e.option) : null;
    if (opt === undefined)
      return refuse(
        "edit-no-match",
        `${n}: ${row.label} has no option ${e.option}; its options are ${options.map((o) => o.key).join(", ") || "none"}. To add or remove options, pass \`options\` whole.`,
      );
    const current =
      e.field === "question" ? question : e.field === "body" ? body : opt!.text;
    const found = occurrences(current, e.old_string);
    if (found === 0)
      return refuse(
        "edit-no-match",
        `${n}: \`old_string\` is not in ${where}${i > 0 ? " (as the earlier edits of this call left it)" : ""}. Match its text exactly — \`read_decision\` shows it (the body without its \`> \` quote marks).`,
      );
    if (found > 1 && e.replace_all !== true)
      return refuse(
        "edit-ambiguous",
        `${n}: \`old_string\` occurs more than once in ${where}. Quote more of the text around it to make it unique, or pass \`replace_all: true\`.`,
      );
    // Bounded before it is built: a replace_all of a short string with a long
    // one must not grow a string far past what the field may hold.
    const parts = e.replace_all === true ? current.split(e.old_string) : null;
    const count = parts === null ? 1 : parts.length - 1;
    const max =
      e.field === "question"
        ? QUESTION_MAX
        : e.field === "body"
          ? BODY_MAX
          : OPTION_TEXT_MAX;
    const length =
      current.length + count * (e.new_string.length - e.old_string.length);
    if (length > max)
      return refuse(
        "edit-invalid",
        `${n}: it would leave ${where} ${length} characters long, past ${max}.`,
      );
    const next =
      parts === null
        ? current.replace(e.old_string, () => e.new_string)
        : parts.join(e.new_string);
    if (e.field === "question") question = next;
    else if (e.field === "body") body = next;
    else opt!.text = next;
  }
  if (edits.some((e) => e.field === "question")) {
    if (question.trim() === "" || question.length > QUESTION_MAX)
      return refuse(
        "edit-invalid",
        `The edits leave the question ${question.trim() === "" ? "empty" : `${question.length} characters long, past ${QUESTION_MAX}`}.`,
      );
    out.question = question;
  }
  if (edits.some((e) => e.field === "body")) {
    if (body.length > BODY_MAX)
      return refuse(
        "edit-invalid",
        `The edits leave the body ${body.length} characters long, past ${BODY_MAX}.`,
      );
    out.body = body;
  }
  if (edits.some((e) => e.field === "option")) {
    for (const o of options)
      if (o.text.trim() === "" || o.text.length > OPTION_TEXT_MAX)
        return refuse(
          "edit-invalid",
          `The edits leave option ${o.key} ${o.text.trim() === "" ? "empty" : `${o.text.length} characters long, past ${OPTION_TEXT_MAX}`}.`,
        );
    out.options = options;
  }
  return out;
}

/** A decision of the caller's task named by its label, or `null`. */
export async function decisionIdByLabel(
  exec: DbExecutor,
  taskId: TaskId,
  label: string,
): Promise<DecisionId | null> {
  return (await byLabel(exec, taskId, label.trim()))?.id ?? null;
}

const ListedSchema = z.object({
  id: z.string(),
  label: z.string(),
  state: z.enum(DECISION_STATES),
  state_label: z.string().nullable(),
  question: z.string(),
  outcome: z.string().nullable(),
  tab: z.enum(DECISION_TABS),
  pending_questions: z.number(),
  last_user_kind: z.string().nullable(),
  last_user_pick: z.string().nullable(),
  last_user_text: z.string().nullable(),
});

export interface ListedDecision {
  id: string;
  label: string;
  state: DecisionState;
  stateLabel: string | null;
  question: string;
  outcome: string | null;
  tab: DecisionTab;
  pendingQuestions: number;
  /** What the user last sent on it (an answer, a question, a kept answer). */
  lastFromUser: {
    kind: string;
    pick: string | null;
    text: string | null;
  } | null;
}

/** A task's decisions, opened first first — the open ones only unless `all`. */
export async function listTaskDecisions(
  exec: DbExecutor,
  taskId: TaskId,
  opts: { all: boolean },
): Promise<ListedDecision[]> {
  const d = _decisions;
  const f = _decisionExchangeFacts;
  const x = _decisionExchanges;
  const tab = decisionTabSql(sql`${d.state}`, {
    unconsumedAnswers: sql`COALESCE(${f.unconsumedAnswers}, 0)`,
    pendingQuestions: sql`COALESCE(${f.pendingQuestions}, 0)`,
  });
  const rows = await executeRows(exec, {
    row: ListedSchema,
    label: "decisions.list-task",
    query: sql`
    SELECT ${d.id} AS id, ${d.label} AS label, ${d.state} AS state,
           ${d.stateLabel} AS state_label, ${d.question} AS question,
           ${d.outcome} AS outcome, ${tab} AS tab,
           COALESCE(${f.pendingQuestions}, 0) AS pending_questions,
           u.kind AS last_user_kind, u.pick AS last_user_pick,
           u.user_text AS last_user_text
      FROM ${d}
      LEFT JOIN ${f} ON ${f.decisionId} = ${d.id}
      LEFT JOIN LATERAL (
        SELECT ${x.kind} AS kind, ${x.pick} AS pick, ${x.userText} AS user_text
          FROM ${x}
         WHERE ${x.decisionId} = ${d.id} AND ${x.kind} <> 'update'
         ORDER BY ${x.createdAt} DESC, ${x.id} DESC
         LIMIT 1
      ) u ON true
     WHERE ${d.taskId} = ${taskId}
       ${opts.all ? sql`` : sql`AND ${d.state} <> 'closed'`}
     ORDER BY ${d.openedAt}, ${d.id}`,
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    state: r.state,
    stateLabel: r.state_label,
    question: r.question,
    outcome: r.outcome,
    tab: r.tab,
    pendingQuestions: r.pending_questions,
    lastFromUser:
      r.last_user_kind === null
        ? null
        : {
            kind: r.last_user_kind,
            pick: r.last_user_pick,
            text: r.last_user_text,
          },
  }));
}

/** How many of a task's decisions are closed (for `list_decisions`' footer). */
export async function countClosed(
  exec: DbExecutor,
  taskId: TaskId,
): Promise<number> {
  const n = countOf(
    await exec
      .select({ n: countSql })
      .from(_decisions)
      .where(
        and(eq(_decisions.taskId, taskId), eq(_decisions.state, "closed")),
      ),
  );
  return n;
}
