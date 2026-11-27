import { text } from "drizzle-orm/pg-core";
import { defineTriggerEvent } from "@plugins/infra/plugins/events/server";

export interface OutcomeReportHandedBackPayload {
  taskId: string;
  conversationId: string;
  /** The agent's last message of the run (markdown). */
  body: string;
  [key: string]: unknown;
}

// Emitted when a run is handed back (machine/internal/handback.ts) — whoever
// cares that a run came back (a watcher, an automation's slot) subscribes,
// rather than the hand-back naming them. Filterable by taskId.
export const {
  event: outcomeReportHandedBack,
  table: _outcomeReportHandedBackTriggers,
} = defineTriggerEvent<OutcomeReportHandedBackPayload>({
  name: "outcomeReport.handedBack",
  filters: {
    taskId: text("task_id"),
  },
});
