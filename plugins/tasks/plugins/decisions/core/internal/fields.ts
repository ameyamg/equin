import { z } from "zod";
import { cappedList } from "@plugins/packages/plugins/list-bound/core";
import { nullable, type FieldsRecord } from "@plugins/fields/core";
import { dateField } from "@plugins/fields/plugins/date/plugins/config/core";
import { jsonField } from "@plugins/fields/plugins/json/plugins/config/core";
import {
  enumTextField,
  textField,
} from "@plugins/fields/plugins/text/plugins/config/core";
import { idKindField } from "@plugins/ids/core";
import { entityRef } from "@plugins/infra/plugins/entities/core";
import { turnIdKind } from "@plugins/conversations/plugins/turn-ledger/core";
import {
  conversationIdKind,
  taskIdKind,
} from "@plugins/tasks/plugins/task-ids/core";
import { decisionExchangeIdKind, decisionIdKind } from "./id-kinds";

/** The most decisions one task holds; `open_decision` refuses one more. */
export const DECISIONS_PER_TASK_MAX = 200;
/** The most exchanges one decision's thread holds; the writes refuse one more. */
export const EXCHANGES_PER_DECISION_MAX = 200;
/** The most options a decision offers. */
export const DECISION_OPTIONS_MAX = 8;

/**
 * Where a decision stands, as the agent sets it. `closed` is the record's end
 * (with an `outcome`); every other state is open:
 *
 * - `decision` — the user must pick (or say what instead);
 * - `action` — the user must do something only they can;
 * - `fyi` — nothing to decide, the user should know (closed by "Got it");
 * - `other` — the agent's own word for it (`stateLabel`, e.g. "Watching").
 */
export const DECISION_STATES = [
  "decision",
  "action",
  "fyi",
  "other",
  "closed",
] as const;
export type DecisionState = (typeof DECISION_STATES)[number];
/** The states an open decision may be in. */
export const OPEN_DECISION_STATES = [
  "decision",
  "action",
  "fyi",
  "other",
] as const satisfies readonly DecisionState[];
export type OpenDecisionState = (typeof OPEN_DECISION_STATES)[number];

/** One option of a decision, as stored: a key ("A", "2", "A+B") and ONE sentence. */
export const DecisionOptionSchema = z.object({
  key: z.string(),
  text: z.string(),
  recommended: z.boolean(),
});
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

/**
 * A decision's fields, in column order — the `decisions` table is built from
 * them (`server/internal/tables.ts`). A decision belongs to a TASK (the
 * agent): it outlives the conversation that opened it.
 *
 * - `label` — unique within the task ("D22"); the agent addresses a decision
 *   by it or by id.
 * - `stateLabel` — non-null iff `state` is `other` (a CHECK).
 * - `outcome` / `closedAt` — non-null iff `state` is `closed` (CHECKs).
 * - `fromDecisionId` — lineage: the decision this one comes from (any task).
 *   "Split into" is derived from it (decisions whose `from` points here).
 * - `seenAt` — when the user last opened it (the "new" mark's baseline).
 */
export const decisionFields = {
  id: idKindField(decisionIdKind),
  taskId: idKindField(taskIdKind, { label: "Task" }),
  openedByConversationId: idKindField(conversationIdKind),
  label: textField({ label: "Label" }),
  state: enumTextField(DECISION_STATES, { label: "State" }),
  stateLabel: nullable(textField({ label: "State label" })),
  question: textField({ label: "Question" }),
  body: textField({ label: "Body" }),
  options: jsonField({
    schema: cappedList(DecisionOptionSchema, { max: DECISION_OPTIONS_MAX }),
    default: [],
  }),
  fromDecisionId: nullable(idKindField(decisionIdKind, { label: "From" })),
  outcome: nullable(textField({ label: "Outcome" })),
  openedAt: dateField({ label: "Opened" }),
  closedAt: nullable(dateField({ label: "Closed" })),
  updatedAt: dateField({ label: "Updated" }),
  seenAt: nullable(dateField({ label: "Seen" })),
} satisfies FieldsRecord;

export const decisionsEntityRef = entityRef("decisions", decisionFields);

/**
 * What one exchange of a thread is:
 *
 * - `answer` — the user picked an option (`pick`), maybe with a note;
 * - `question` — the user wrote a note without a pick; the agent answers it
 *   with `update_decision({ reply })` (`agentText`);
 * - `update` — a note of the agent's (`agentText`), open or closed;
 * - `recorded` — an answer kept but not delivered (its agent had finished).
 */
export const EXCHANGE_KINDS = [
  "answer",
  "question",
  "update",
  "recorded",
] as const;
export type ExchangeKind = (typeof EXCHANGE_KINDS)[number];

/**
 * A decision's thread, append-only but for the agent's reply to a question
 * and an answer's `consumedAt`. It outlives closing: notes after the outcome
 * are ordinary rows.
 *
 * - `consumedAt` — an `answer`: when the agent next updated the decision,
 *   which ends "Sent".
 * - `turnId` — the event turn that delivered it (phase 3's delivery).
 */
export const decisionExchangeFields = {
  id: idKindField(decisionExchangeIdKind),
  decisionId: idKindField(decisionIdKind),
  kind: enumTextField(EXCHANGE_KINDS, { label: "Kind" }),
  pick: nullable(textField({ label: "Pick" })),
  userText: nullable(textField({ label: "Note" })),
  agentText: nullable(textField({ label: "Agent" })),
  agentAt: nullable(dateField({ label: "Agent at" })),
  turnId: nullable(idKindField(turnIdKind)),
  consumedAt: nullable(dateField({ label: "Consumed" })),
  createdAt: dateField({ label: "Created" }),
} satisfies FieldsRecord;

export const decisionExchangesEntityRef = entityRef(
  "decision_exchanges",
  decisionExchangeFields,
);
