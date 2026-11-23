import { defineRequestSink } from "@plugins/primitives/plugins/report-sink/core";

/**
 * Who asked for a report's investigation task: a person (Investigate), or
 * the system on a stream's behalf — a stream that owns its reports gives each
 * its one task, in the backlog of the supervisor role it is routed to (an
 * `srole-…` id), or a plain task while it is routed to none.
 */
export type InvestigationRequester =
  { kind: "person" } | { kind: "system"; backlogOf: string | null };

export interface InvestigationTaskRequest {
  existingTaskId: string | null;
  title: string;
  description: string;
  /** The plugin id of the surface that asked (a task's `filedFrom`). */
  filedFrom: string;
  requestedBy: InvestigationRequester;
}

// reports emits here on its investigate path; the tasks domain registers the
// task-creating handler. Absent handler (a composition without tasks) → emit
// returns undefined → investigateReport throws loudly (misconfiguration).
export const reportInvestigationSink = defineRequestSink<
  InvestigationTaskRequest,
  Promise<{ taskId: string }>
>("reports:reportInvestigationSink");
