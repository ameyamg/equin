import { z } from "zod";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { getConversation } from "@plugins/tasks/plugins/tasks-core/server";
import { grantOf } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { reportRequired } from "@plugins/tasks/plugins/outcome-report/plugins/capability/core";
import { openQuestionsOf } from "@plugins/conversations/plugins/question-relay/server";
import { recordNotification } from "@plugins/shell/plugins/notifications/server";
import {
  conversationRoute,
  QUESTION_WAITING_FOR,
} from "@plugins/conversations/core";
import { agentManagerApp } from "@plugins/apps/plugins/agent-manager/plugins/shell/core";

/**
 * Rings the bell when an agent nobody watches (its mandate hands its runs
 * back) starts waiting on an AskUserQuestion: the user would otherwise never
 * learn it is blocked on them. One row per conversation; a new question
 * re-alerts.
 */
export const questionBellJob = defineJob({
  name: "outcome-report.question-bell",
  description:
    "When an automation's or a supervisor's worker's agent starts waiting on its AskUserQuestion, notifies the user with the question.",
  hold: "instant",
  input: z.object({}),
  // One notification row per conversation (its dedupe key).
  dedup: "none",
  event: z
    .object({
      conversationId: z.string(),
      waitingFor: z.string().nullable(),
      previousWaitingFor: z.string().nullable(),
    })
    .passthrough(),
  run: async ({ event }) => {
    if (!event) return;
    if (event.waitingFor !== QUESTION_WAITING_FOR) return;
    if (event.previousWaitingFor === QUESTION_WAITING_FOR) return;
    const { conversationId } = event;
    if ((await grantOf(reportRequired, conversationId)) === null) return;
    const conversation = await getConversation(conversationId);
    if (conversation === null) return;
    // Answered or withdrawn since the event: nothing to ring for.
    const questions = await openQuestionsOf(conversationId);
    if (questions === null) return;
    await recordNotification({
      type: "agent-question",
      variant: "info",
      title: `Your call: ${conversation.taskTitle}`,
      description: questions.join("\n"),
      linkTo: conversationRoute.link(agentManagerApp, {
        convId: conversationId,
      }),
      metadata: { taskId: conversation.taskId, conversationId },
      dedupeKey: `agent-question:${conversationId}`,
      resurfaceAfterMs: 0,
    });
  },
});
