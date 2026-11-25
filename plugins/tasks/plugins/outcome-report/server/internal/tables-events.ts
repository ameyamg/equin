import { text } from "drizzle-orm/pg-core";
import { defineTriggerEvent } from "@plugins/infra/plugins/events/server";
import type { ReportStanding } from "../../core";

export interface OutcomeReportSubmittedPayload {
  taskId: string;
  conversationId: string;
  standing: ReportStanding;
  /** The report itself: the agent's last message of the run (markdown). */
  body: string;
  [key: string]: unknown;
}

// Emitted when a run is handed back (machine/internal/handback.ts), right after
// the report row is written — whoever cares that a run came back (a watcher,
// an automation's slot) subscribes, rather than the hand-back naming them.
// Filterable by taskId.
export const {
  event: outcomeReportSubmitted,
  table: _outcomeReportSubmittedTriggers,
} = defineTriggerEvent<OutcomeReportSubmittedPayload>({
  name: "outcomeReport.submitted",
  filters: {
    taskId: text("task_id"),
  },
});
