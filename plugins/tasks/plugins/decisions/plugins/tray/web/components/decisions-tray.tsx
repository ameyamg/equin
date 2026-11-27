import type { ReactElement } from "react";
import type { Conversation as ConversationRecord } from "@plugins/tasks/plugins/tasks-core/core";
import { useOpenPane } from "@plugins/primitives/plugins/pane/web";
import { taskIdKind } from "@plugins/tasks/plugins/task-ids/core";
import { TaskDecisionsPanel } from "@plugins/tasks/plugins/decisions/web";
import { decisionsPane } from "@plugins/tasks/plugins/decisions/plugins/inbox/web";
import { convDecisionsPane } from "../panes";

/**
 * The decisions this conversation's agent raised, above its composer: its
 * task's {@link TaskDecisionsPanel}, absent while none waits on the user. Not drawn in
 * the transcript: the agent edits a decision after opening it, so the record
 * is shown live here, not as the tool call that opened it. Its side-pane icon
 * moves them into a pane beside the conversation; the tray folds to its
 * header while that pane is open.
 */
export function DecisionsTray({
  conversation,
}: {
  conversation: ConversationRecord;
}): ReactElement | null {
  const openPane = useOpenPane();
  const beside = convDecisionsPane.useToggle({ conv: conversation.id });
  return (
    <TaskDecisionsPanel
      taskId={taskIdKind.parse(conversation.taskId)}
      inboxLink={openPane.to(decisionsPane, {}, { mode: "root" })}
      whenSettled="hide"
      beside={beside}
    />
  );
}
