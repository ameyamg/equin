import {
  runInBackgroundLane,
  runWithoutProfiling,
} from "@plugins/infra/plugins/runtime-profiler/core";
import { ReportRecorded, reportHasLiveOwner } from "@plugins/reports/server";

/**
 * Tell every {@link ReportRecorded} listener that `row` was written — when it
 * is one nobody is investigating: no live owner (`reportHasLiveOwner`: a
 * linked task that was dropped is none), not noise. The one gate, shared by
 * the two writes that can put a report on the worklist: an occurrence
 * (`recordReport`) and a regression, which unlinks the task of the fix that
 * did not hold (`deriveReportFixState`). The regressing occurrence itself is
 * judged off the write path, after its row was written with the task still
 * linked — so without the second call a regression, the most newsworthy
 * occurrence a report has, would reach no listener.
 *
 * Only the occurrence being written is announced: a report whose owner was
 * dropped comes back on its NEXT occurrence, never as a replay of the ones
 * recorded while the task held it.
 */
export async function announceRecorded(row: {
  id: string;
  taskId: string | null;
  noise: boolean;
}): Promise<void> {
  if (row.noise) return;
  // The owner read runs on the recording path: kept out of the slow-op
  // recorder and off the caller's lane, as the report write itself is
  // (`recordReport`), so it can never re-feed the recorder it serves.
  const owned = await runInBackgroundLane(() =>
    runWithoutProfiling(() => reportHasLiveOwner(row.taskId)),
  );
  if (owned) return;
  for (const l of ReportRecorded.getContributions()) l.onRecorded(row.id);
}
