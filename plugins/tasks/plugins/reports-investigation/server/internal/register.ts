import { asPluginId } from "@plugins/framework/plugins/plugin-id/core";
import { sinkHandler } from "@plugins/framework/plugins/server-core/core";
import { interactiveMandate } from "@plugins/tasks/plugins/mandate-presets/core";
import { createTask, getTask } from "@plugins/tasks/plugins/tasks-core/server";
import { setTaskCategory } from "@plugins/tasks/plugins/task-category/server";
import {
  reportInvestigationSink,
  reportOwnerSink,
} from "@plugins/reports/server";

// The category investigation tasks are stamped with; the plugin contributes the
// matching TaskCategory registration.
export const REPORTS_CATEGORY_ID = "reports";

// The task-creating handler on reports' investigation sink. reports emits into
// the sink on its investigate path; this bridge holds the `tasks` dependency, so
// a standalone composition that doesn't ship it simply leaves the sink without
// a handler (emit → undefined → investigateReport throws loudly). Idempotency:
// reports hands over the linked task only while it owns the report (the owner
// answer below), and that task is reused.
export const reportInvestigationHandler = sinkHandler(
  reportInvestigationSink,
  () =>
    async ({ existingTaskId, title, description, filedFrom }) => {
      if (existingTaskId) return { taskId: existingTaskId };
      const task = await createTask({
        title,
        description,
        // A person clicked Investigate: the task is theirs.
        filing: { author: { kind: "human" }, filedFrom: asPluginId(filedFrom) },
        mandate: interactiveMandate,
      });
      await setTaskCategory(task.id, REPORTS_CATEGORY_ID);
      return { taskId: task.id };
    },
);

/**
 * The tasks half of reports' owner question (`reportHasLiveOwner`): a linked
 * task owns its report while it exists and is not dropped. Answered here so
 * dropping a task needs no report knowledge.
 */
export async function isLiveReportOwner(taskId: string): Promise<boolean> {
  const task = await getTask(taskId);
  return task !== null && task.status !== "dropped";
}

export const reportOwnerHandler = sinkHandler(
  reportOwnerSink,
  () =>
    ({ taskId }) =>
      isLiveReportOwner(taskId),
);
