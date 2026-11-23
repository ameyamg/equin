import { defineRequestSink } from "@plugins/primitives/plugins/report-sink/core";

export interface InvestigationTaskRequest {
  /** The report's live owner (`reportHasLiveOwner`), reused as the answer; null files a new task. */
  existingTaskId: string | null;
  title: string;
  description: string;
  /**
   * The plugin id of the surface that asked (a task's `filedFrom`). The
   * author is always the person who clicked Investigate.
   */
  filedFrom: string;
}

// reports emits here on its investigate path; the tasks domain registers the
// task-creating handler. Absent handler (a composition without tasks) → emit
// returns undefined → investigateReport throws loudly (misconfiguration).
export const reportInvestigationSink = defineRequestSink<
  InvestigationTaskRequest,
  Promise<{ taskId: string }>
>("reports:reportInvestigationSink");
