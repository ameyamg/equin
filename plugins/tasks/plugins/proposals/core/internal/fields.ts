import { z } from "zod";
import {
  nullable,
  type FieldOptionMeta,
  type FieldsRecord,
} from "@plugins/fields/core";
import { boolField } from "@plugins/fields/plugins/bool/plugins/config/core";
import { dateField } from "@plugins/fields/plugins/date/plugins/config/core";
import { intField } from "@plugins/fields/plugins/int/plugins/config/core";
import { jsonField } from "@plugins/fields/plugins/json/plugins/config/core";
import { stringListField } from "@plugins/fields/plugins/string-list/plugins/config/core";
import {
  enumTextField,
  textField,
} from "@plugins/fields/plugins/text/plugins/config/core";
import { idKindField } from "@plugins/ids/core";
import { entityRef } from "@plugins/infra/plugins/entities/core";
import { wholeRecord } from "@plugins/packages/plugins/list-bound/core";
import {
  conversationIdKind,
  taskIdKind,
} from "@plugins/tasks/plugins/task-ids/core";
import { proposalIdKind } from "./id-kinds";

/**
 * Where a proposal stands:
 *
 * - `open` — waiting for the user;
 * - `accepted` — applied through its owner's own write path;
 * - `rejected` — the user said no;
 * - `changes-requested` — the user asked the agent to revise; its next
 *   revision supersedes it;
 * - `superseded` — a newer revision of the same record from the same task
 *   replaced it.
 */
export const PROPOSAL_STATES = [
  "open",
  "accepted",
  "rejected",
  "changes-requested",
  "superseded",
] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

export const PROPOSAL_STATE_META: {
  readonly [S in ProposalState]: FieldOptionMeta;
} = {
  open: { label: "Proposed", variant: "info" },
  accepted: { label: "Accepted", variant: "success" },
  rejected: { label: "Rejected", variant: "muted" },
  "changes-requested": { label: "Changes requested", variant: "warning" },
  superseded: { label: "Replaced", variant: "muted" },
};

/** A record type's id, as its owner registers it (`Proposals.Type`). */
export const PROPOSAL_TYPE_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
export const ProposalTypeIdSchema = z.string().regex(PROPOSAL_TYPE_ID_PATTERN);

/** A record's values: one per field of its type's scope (an owner caps the count). */
export const ProposalValuesSchema = wholeRecord(z.unknown(), {
  reason:
    "one record's values — one per field of its type's scope, which the owner's FieldsRecord bounds",
});
export type ProposalValues = z.infer<typeof ProposalValuesSchema>;

/**
 * One proposed change to one record on main, made by an agent in its
 * worktree and handed over by `./equin propose`. Main's record is the base:
 * `baseValues` / `baseVersion` are main's record when the proposal arrived
 * (null for a new record), `values` the whole record as proposed, `changed`
 * the keys it changes against the base.
 *
 * - `recordId` — the record's id in the worktree, which for a new record is
 *   the id it takes on main once accepted.
 * - `editedOnMainSinceFork` — main's record moved after the worktree's
 *   database was forked from it: a difference may undo the user's own edit.
 * - `revision` / `previousId` — v1, v2… of one record from one task; a new
 *   revision supersedes the open one.
 */
export const proposalFields = {
  id: idKindField(proposalIdKind),
  type: textField({ label: "Type" }),
  scope: textField({ label: "Scope" }),
  recordId: textField({ label: "Record" }),
  isNew: boolField({ label: "New record" }),
  baseVersion: nullable(textField({ label: "Base version" })),
  baseValues: nullable(jsonField({ schema: ProposalValuesSchema })),
  values: jsonField({ schema: ProposalValuesSchema, default: {} }),
  changed: stringListField({ label: "Changed" }),
  note: textField({ label: "Note" }),
  authorTaskId: idKindField(taskIdKind, { label: "Task" }),
  authorConversationId: idKindField(conversationIdKind, {
    label: "Conversation",
  }),
  worktree: textField({ label: "Worktree" }),
  editedOnMainSinceFork: boolField({ label: "Edited on main since" }),
  revision: intField({ label: "Revision" }),
  previousId: nullable(idKindField(proposalIdKind, { label: "Replaces" })),
  state: enumTextField(PROPOSAL_STATES, {
    label: "State",
    options: PROPOSAL_STATE_META,
  }),
  decisionNote: nullable(textField({ label: "Your note" })),
  decidedAt: nullable(dateField({ label: "Decided" })),
  createdAt: dateField({ label: "Proposed" }),
  updatedAt: dateField({ label: "Updated" }),
} satisfies FieldsRecord;

export const proposalsEntityRef = entityRef("proposals", proposalFields);
