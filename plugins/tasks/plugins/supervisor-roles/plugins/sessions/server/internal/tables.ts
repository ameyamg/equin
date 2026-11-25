import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { parsedText } from "@plugins/database/plugins/sql-column/server";
import { StoredModelChoiceSchema } from "@plugins/conversations/plugins/model-provider/core";
import { _tasks } from "@plugins/tasks/plugins/tasks-core/server";
import { _supervisorRoles } from "@plugins/tasks/plugins/supervisor-roles/server";

/**
 * A role session's hand-off to the next one (`handoff`): what the ending
 * session wrote for its successor, keyed by the session root it ends. Pending
 * while `consumedAt` is null — the role's next launch (`openRoleSession`,
 * whatever launches it) takes it into its brief and stamps `toTaskId`. At
 * most one pending per role. Kept afterwards: which session handed what to
 * which.
 */
export const _supervisorSessionHandoffs = pgTable(
  "supervisor_session_handoffs",
  {
    fromTaskId: text("from_task_id")
      .primaryKey()
      .references(() => _tasks.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => _supervisorRoles.id, { onDelete: "cascade" }),
    /** What the ending session wrote for the next one. */
    handoff: text("handoff").notNull(),
    /** The model the next session launches with; null = the default. */
    model: parsedText("model", StoredModelChoiceSchema),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    /** The session that took it. */
    toTaskId: text("to_task_id").references(() => _tasks.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("supervisor_session_handoffs_pending_idx")
      .on(t.roleId)
      .where(sql`${t.consumedAt} IS NULL`),
  ],
);
