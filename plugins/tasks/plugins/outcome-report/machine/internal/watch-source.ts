import { QUESTION_WAITING_FOR } from "@plugins/conversations/core";
import { conversationStatusChanged } from "@plugins/tasks/plugins/tasks-core/server";
import { watchSource } from "@plugins/tasks/plugins/orchestration/plugins/watch/machine";
import { grantOf } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { reportRequired } from "@plugins/tasks/plugins/outcome-report/plugins/capability/core";
import { outcomeReportSubmitted } from "../../server/internal/tables-events";

/** A handed-back run reaches whoever watches its task: `reported`, its
 * summary the whole report. */
export const outcomeReportWatchSource = watchSource({
  id: "outcome-report",
  on: outcomeReportSubmitted,
  toEvents: (p) => [
    {
      kind: "reported",
      taskId: p.taskId,
      actorConversationId: p.conversationId,
      summary: `report (${p.standing}):\n${p.body}`,
      payload: { standing: p.standing },
    },
  ],
});

/** An agent whose runs are handed back that starts waiting on its
 * AskUserQuestion reaches whoever watches its task once: `asking` — it is
 * blocked on the user, not done. Any other conversation's question is the
 * user's own exchange, not news for a watcher. */
export const askingWatchSource = watchSource({
  id: "outcome-report.asking",
  on: conversationStatusChanged,
  toEvents: async (p) =>
    p.taskId !== null &&
    p.waitingFor === QUESTION_WAITING_FOR &&
    p.previousWaitingFor !== QUESTION_WAITING_FOR &&
    (await grantOf(reportRequired, p.conversationId)) !== null
      ? [
          {
            kind: "asking",
            taskId: p.taskId,
            actorConversationId: p.conversationId,
            summary:
              "asks the user (AskUserQuestion) and waits for their answer",
          },
        ]
      : [],
});
