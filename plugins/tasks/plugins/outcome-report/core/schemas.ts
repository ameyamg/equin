import { z } from "zod";
import { liveCollection } from "@plugins/network/plugins/live/core";
import { nullable } from "@plugins/fields/core";
import {
  enumTextField,
  textField,
} from "@plugins/fields/plugins/text/plugins/config/core";
import { dateField } from "@plugins/fields/plugins/date/plugins/config/core";
import { defineExtensionShape } from "@plugins/infra/plugins/entity-extensions/core";
import type { Standing } from "@plugins/tasks/plugins/attempt-work/core";

/**
 * Where the attempt's work stood when the run was handed back — attempt-work's
 * `Standing`, measured from git at hand-back time: `landed` (in main), `pending`
 * (a built branch waiting for its push), `none` (nothing committed). Stored
 * rather than a `pushed` bool because "stopped at a built branch" is exactly
 * the case the reader has to act on.
 */
export const REPORT_STANDINGS = [
  "none",
  "pending",
  "landed",
] as const satisfies readonly Standing[];
export type ReportStanding = (typeof REPORT_STANDINGS)[number];

// The `tasks_ext_outcome_report` row: the latest run an agent handed back for
// its task (one per task; a later hand-back replaces it) — `body` is the
// agent's last message of that run, captured at its turn's end (no tool
// writes it). `server/internal/tables.ts` builds the side-table from this
// shape; the wire row is its `schema`.
export const outcomeReportShape = defineExtensionShape({
  key: "taskId",
  fields: {
    conversationId: textField(),
    body: textField(),
    standing: enumTextField(REPORT_STANDINGS),
    /** The handed-back message's id (the API's), so one message is handed
     * back once whichever path sees its turn end; null for older rows. */
    messageId: nullable(textField()),
    submittedAt: dateField(),
  },
});
export const OutcomeReportSchema = outcomeReportShape.schema;
export type OutcomeReport = z.infer<typeof OutcomeReportSchema>;

// ONE task's report, read by the task's id: lookup-only (nothing lists every
// report), minting `outcome-reports:rows` alone. A reader asks with
// `useLive(outcomeReportRows, { id: taskId })`; `found: false` is "no report yet".
// The `:rows` point routing sends a submit only to the readers of that task.
// Served from the extension handle in `server/internal/resource.ts`.
export const outcomeReportRows = liveCollection("outcome-reports", {
  from: outcomeReportShape,
  id: "taskId",
});

/**
 * Who an agent's turn is for, once the user has talked to it in this run
 * (`turn_for`): `user` — the reply is theirs, nobody else is told; `supervisor`
 * — the run is handed back to whoever started it (a supervisor, an
 * automation): its last message becomes the report.
 */
export const TURN_ADDRESSEES = ["user", "supervisor"] as const;
export const TurnAddresseeSchema = z.enum(TURN_ADDRESSEES);
export type TurnAddressee = z.infer<typeof TurnAddresseeSchema>;
