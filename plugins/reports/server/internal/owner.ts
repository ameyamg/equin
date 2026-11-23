import { defineRequestSink } from "@plugins/primitives/plugins/report-sink/core";

// reports names the task that owns a report (`reports.task_id`) but cannot
// read tasks: the tasks domain answers here whether that task is still live
// (exists and is not dropped). reports owns the question, tasks the answer —
// so dropping a task needs no report knowledge, and the link stays as history.
export const reportOwnerSink = defineRequestSink<
  { taskId: string },
  Promise<boolean>
>("reports:reportOwnerSink");

/**
 * Whether someone is on this report: the ONE definition of a report's owner,
 * read by every gate that skips an owned report (the ReportRecorded
 * announcement, the supervisor report streams, Investigate's reuse of the
 * linked task). A linked task that was dropped — or deleted — is no owner, so
 * the report's next occurrence is news again. With no tasks domain to answer
 * (a composition without tasks), no linked task can be live: no owner.
 */
export async function reportHasLiveOwner(
  taskId: string | null,
): Promise<boolean> {
  if (taskId === null) return false;
  return (await reportOwnerSink.emit({ taskId })) ?? false;
}
