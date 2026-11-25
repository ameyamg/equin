import { db } from "@plugins/database/server";
import { serveValue } from "@plugins/network/plugins/live/machine";
import {
  _attempts,
  _conversations,
} from "@plugins/tasks/plugins/tasks-core/server";
import { latestAgentConversation } from "@plugins/tasks/plugins/orchestration/plugins/message/server";
import { decisionAgent, type DecisionAgent } from "../../core";

/**
 * A task's agent: its latest agent conversation, finished when that is `done`
 * — the same reading delivery takes (`deliverEventTurn`). `null` when no agent
 * ran on it.
 */
export async function taskAgent(taskId: string): Promise<DecisionAgent | null> {
  const c = await latestAgentConversation(db, taskId);
  return c === null
    ? null
    : { conversationId: c.id, finished: c.status === "done" };
}

/** Whether a task's agent has finished (delivery's question). */
export async function taskAgentFinished(taskId: string): Promise<boolean> {
  return (await taskAgent(taskId))?.finished === true;
}

// A task's agent, per task: read beside a drafted answer (kept, not sent) and
// by every link to the agent asking a decision. Recomputed on a conversation
// or attempt write — each tuple one indexed read, and only the tasks on
// screen are subscribed.
export const decisionAgentServed = serveValue(decisionAgent, {
  source: "db",
  reads: {
    tables: [_attempts, _conversations],
    reason:
      "a task's agent is its latest conversation under the task's mandate, read through its attempts",
  },
  loader: ({ taskId }) => taskAgent(taskId),
});
