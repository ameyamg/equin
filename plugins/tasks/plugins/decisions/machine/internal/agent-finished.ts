import { db } from "@plugins/database/server";
import { serveValue } from "@plugins/network/plugins/live/machine";
import {
  _attempts,
  _conversations,
} from "@plugins/tasks/plugins/tasks-core/server";
import { latestAgentConversation } from "@plugins/tasks/plugins/orchestration/plugins/message/server";
import { decisionAgentFinished } from "../../core";

/**
 * Whether a task's agent has finished: its latest agent conversation is
 * `done` — the same reading delivery takes (`deliverEventTurn`).
 */
export async function taskAgentFinished(taskId: string): Promise<boolean> {
  return (await latestAgentConversation(db, taskId))?.status === "done";
}

// A task's agent finished or not, per task: read beside a drafted answer
// (kept, not sent). Recomputed on a conversation or attempt write — each
// tuple one indexed read, and only the tasks with an answer drafted are
// subscribed.
export const decisionAgentFinishedServed = serveValue(decisionAgentFinished, {
  source: "db",
  reads: {
    tables: [_attempts, _conversations],
    reason:
      "a task's agent is its latest conversation under the task's mandate, read through its attempts",
  },
  loader: ({ taskId }) => taskAgentFinished(taskId),
});
