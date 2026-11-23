import { z } from "zod";
import { inArray } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { defineWarmup } from "@plugins/infra/plugins/warmup/server";
import {
  TaskStatusSchema,
  SETTLED_STATUSES,
  isSettled,
} from "@plugins/tasks/plugins/tasks-core/core";
import {
  readTaskStatuses,
  tasksView,
} from "@plugins/tasks/plugins/tasks-core/server";
import { clearTaskManageGrant } from "./grant";
import { _tasksManageGrantExt } from "./tables";

// The grant ends with its task: done or dropped, it is removed (a re-opened
// task does not get it back). Its holder is read as not granted from the
// moment the task settles (`grantHeld` reads the status); this makes it so
// for good. The status is read again here rather than trusted from the
// event: a task settled, re-opened and granted again before this run must
// keep its new grant.
export const clearGrantOnSettleJob = defineJob({
  name: "tasks.manage-grant-clear-on-settle",
  description:
    "Removes a task's 'may manage tasks it doesn't own' grant once the task is done or dropped.",
  hold: "instant",
  input: z.object({}),
  dedup: "none",
  event: z
    .object({ taskId: z.string(), status: TaskStatusSchema })
    .passthrough(),
  run: async ({ event }) => {
    if (!event || !isSettled(event.status)) return;
    await db.transaction(async (tx) => {
      const now = (await readTaskStatuses([event.taskId], tx)).get(
        event.taskId,
      );
      if (now === undefined || !isSettled(now.status)) return;
      await clearTaskManageGrant(event.taskId, `its task is ${now.status}`, tx);
    });
  },
});

// The backlog the job cannot reach: a task settled while this backend was down.
export const clearGrantSweepWarmup = defineWarmup({
  name: "tasks.manage-grant-sweep",
  description:
    "Removes, at startup, the 'may manage tasks it doesn't own' grant of every task that is done or dropped.",
  scope: "host",
  run: async () => {
    const rows = await db
      .select({ taskId: _tasksManageGrantExt.taskId })
      .from(_tasksManageGrantExt)
      .where(
        inArray(
          _tasksManageGrantExt.taskId,
          db
            .select({ id: tasksView.id })
            .from(tasksView)
            .where(inArray(tasksView.status, [...SETTLED_STATUSES])),
        ),
      );
    for (const { taskId } of rows)
      await clearTaskManageGrant(taskId, "its task is done or dropped");
  },
});
