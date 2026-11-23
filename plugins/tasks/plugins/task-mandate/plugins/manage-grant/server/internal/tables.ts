import { index } from "drizzle-orm/pg-core";
import { _tasks } from "@plugins/tasks/plugins/tasks-core/server";
import { defineExtension } from "@plugins/infra/plugins/entity-extensions/server";
import {
  defaultNow,
  defineEntity,
} from "@plugins/infra/plugins/entities/server";
import { taskManageGrantShape, unownedActionsEntityRef } from "../../core";

// The grant on one task (see the shape): a row = on; a task's deletion
// cascades it away.
export const tasksManageGrant = defineExtension(
  _tasks,
  "manage_grant",
  taskManageGrantShape,
);
// Re-exported so drizzle-kit discovers the underlying pgTable.
export const _tasksManageGrantExt = tasksManageGrant.table;

// The audit of everything done under a grant, and the grant's own switches:
// one task's rows, newest first (the task detail's section).
const unownedActionsEntity = defineEntity(unownedActionsEntityRef, {
  primaryKey: "id",
  columns: { createdAt: { default: defaultNow() } },
  indexes: (t) => [
    index("task_unowned_actions_task_idx").on(t.taskId, t.createdAt),
  ],
});
// drizzle-kit schema-glob discovery.
export const _taskUnownedActions = unownedActionsEntity.table;
