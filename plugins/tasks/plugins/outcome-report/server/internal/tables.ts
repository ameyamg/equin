import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import {
  _conversations,
  _tasks,
} from "@plugins/tasks/plugins/tasks-core/server";
import { defineExtension } from "@plugins/infra/plugins/entity-extensions/server";
import { parsedText } from "@plugins/database/plugins/sql-column/server";
import { outcomeReportShape, TurnAddresseeSchema } from "../../core";

export const taskOutcomeReports = defineExtension(
  _tasks,
  "outcome_report",
  outcomeReportShape,
);
// Re-exported so drizzle-kit discovers the underlying pgTable.
export const _taskOutcomeReportsExt = taskOutcomeReports.table;

/**
 * The latest `turn_for` an agent declared, one row per conversation: whom its
 * turn is for once the user has talked to it. Only the latest counts — the
 * stop gate asks whether it came after the user's latest word, and the
 * turn-end capture whether it says `supervisor`.
 * - `awaiting` — with `user`, the reply or decision it waits on;
 * - `usedAt` — the end of the turn it was for, set by the hand-back (null:
 *   not used yet, so it still counts). A used `user` row with no word from
 *   the user since is the recorded verdict "its last turn rests on the user"
 *   the digest shows a supervisor.
 */
export const _turnAddressees = pgTable("outcome_report_turn_addressees", {
  conversationId: text("conversation_id")
    .primaryKey()
    .references(() => _conversations.id, { onDelete: "cascade" }),
  to: parsedText("to", TurnAddresseeSchema).notNull(),
  declaredAt: timestamp("declared_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  awaiting: text("awaiting"),
  usedAt: timestamp("used_at", { withTimezone: true }),
});
