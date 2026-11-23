import { asPluginId } from "@plugins/framework/plugins/plugin-id/core";
import { sinkHandler } from "@plugins/framework/plugins/server-core/core";
import { interactiveMandate } from "@plugins/tasks/plugins/mandate-presets/core";
import { createTask, getTask } from "@plugins/tasks/plugins/tasks-core/server";
import { setTaskCategory } from "@plugins/tasks/plugins/task-category/server";
import { fileSystemBacklogTask } from "@plugins/tasks/plugins/supervisor-roles/server";
import { db } from "@plugins/database/server";
import { reportInvestigationSink } from "@plugins/reports/server";

// The category investigation tasks are stamped with; the plugin contributes the
// matching TaskCategory registration.
export const REPORTS_CATEGORY_ID = "reports";

/**
 * Whether a report's linked task still owns it: any task but a dropped one.
 * A DONE task keeps owning its report: its fix is in the fix ledger (pending,
 * fixed) or the report is the person's to close — a regression unlinks it
 * anyway (the engine), which is when a new task is due. Treating done as
 * ownerless would re-file a task at every boot for a report whose test went
 * green without a fix claim. The one definition: Investigate reuses an owning
 * task, and a stream that owns its reports files a new one only for a report
 * no task owns.
 */
function ownsReport(status: string): boolean {
  return status !== "dropped";
}

// The task-creating handler on reports' investigation sink. reports emits into
// the sink on its investigate path; this bridge holds the `tasks` dependency, so
// a standalone composition that doesn't ship it simply leaves the sink without
// a handler (emit → undefined → investigateReport throws loudly). Idempotency
// lives here: a report already linked to a task that owns it reuses it.
//
// Who asked decides who the task is from and where it lands: a person's
// Investigate files their own root task; the system (a stream that owns its
// reports) files a system task — into the backlog of the supervisor role the
// stream is routed to, where that role's session adopts it, or as a plain
// root task while the stream is routed to none.
export const reportInvestigationHandler = sinkHandler(
  reportInvestigationSink,
  () =>
    async ({ existingTaskId, title, description, filedFrom, requestedBy }) => {
      if (existingTaskId) {
        const linked = await getTask(existingTaskId);
        if (linked && ownsReport(linked.status)) return { taskId: linked.id };
      }
      const from = asPluginId(filedFrom);
      let taskId: string;
      if (requestedBy.kind === "system" && requestedBy.backlogOf !== null) {
        const roleId = requestedBy.backlogOf;
        taskId = await db.transaction((tx) =>
          fileSystemBacklogTask(
            { roleId, title, description, filedFrom: from },
            tx,
          ),
        );
      } else {
        const task = await createTask({
          title,
          description,
          filing: {
            author:
              requestedBy.kind === "person"
                ? { kind: "human" }
                : { kind: "system" },
            filedFrom: from,
          },
          mandate: interactiveMandate,
        });
        taskId = task.id;
      }
      await setTaskCategory(taskId, REPORTS_CATEGORY_ID);
      return { taskId };
    },
);
