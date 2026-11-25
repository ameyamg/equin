import { db } from "@plugins/database/server";
import { getConversation } from "@plugins/tasks/plugins/tasks-core/server";
import { taskIdKind } from "@plugins/tasks/plugins/task-ids/core";
import { StopGate } from "@plugins/conversations/plugins/stop-gate/server";
import { ExitClean } from "@plugins/conversations/plugins/conversation-view/plugins/push-and-exit/plugins/exit-precondition/server";
import { latestAgentConversation } from "@plugins/tasks/plugins/orchestration/plugins/message/server";
import {
  decisionsAwaitingUser,
  owedDecisions,
  owedMessage,
} from "../../server/internal/owing";

/**
 * The task `conversationId` is the agent of — the one answers are typed into
 * (its task's latest conversation under the task's mandate) — or `null` for
 * any other conversation (a side chat, an older one), which owes nothing.
 */
async function agentTaskOf(conversationId: string) {
  const conversation = await getConversation(conversationId);
  if (conversation === null) return null;
  const taskId = taskIdKind.key(conversation.taskId);
  const agent = await latestAgentConversation(db, taskId);
  return agent?.id === conversationId ? taskId : null;
}

/**
 * The agent (its task's latest conversation — what answers are typed into)
 * may not stop while it owes the user: a reply to a question the
 * user sent on one of its decisions, or acting on an answer. Waiting for the
 * user to decide is not owing — that stop is allowed (the answer wakes it).
 */
export const decisionsStopGate = StopGate({
  id: "decisions.owed",
  async check(conversationId) {
    const taskId = await agentTaskOf(conversationId);
    if (taskId === null) return { kind: "allow" };
    const message = owedMessage(await owedDecisions(db, taskId));
    return message === null
      ? { kind: "allow" }
      : { kind: "block", reason: message };
  },
});

/**
 * The agent may not finish cleanly while its decisions are unsettled: what
 * it owes (as the stop gate), and any decision or action still waiting on the
 * user — an answer to a finished agent is only kept, never sent, so close
 * what no longer needs the user, or raise a flag to wait for them.
 */
export const decisionsExitGate = ExitClean.Precondition({
  id: "decisions.unsettled",
  async check(conversationId) {
    const taskId = await agentTaskOf(conversationId);
    if (taskId === null) return null;
    const owed = owedMessage(await owedDecisions(db, taskId));
    if (owed !== null) return { message: owed };
    const waiting = await decisionsAwaitingUser(db, taskId);
    if (waiting.length === 0) return null;
    const labels =
      waiting.length > 10
        ? `${waiting.slice(0, 10).join(", ")} and more`
        : waiting.join(", ");
    return {
      message: `${labels} still ${waiting.length === 1 ? "waits" : "wait"} on the user: an answer after you exit would only be kept, never sent to you. Close what no longer needs them (update_decision({ decision, state: "closed", outcome })), or raise a flag (flag_raise) to wait for the user.`,
    };
  },
});
