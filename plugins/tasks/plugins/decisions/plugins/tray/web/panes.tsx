import type { ReactElement } from "react";
import {
  Pane,
  PaneChrome,
  defineRoute,
  impliedBy,
  sameAs,
} from "@plugins/primitives/plugins/pane/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { conversationRoute } from "@plugins/conversations/core";
import { useConversationById } from "@plugins/conversations/web";
import { agentManagerApp } from "@plugins/apps/plugins/agent-manager/plugins/shell/core";
import { taskIdKind } from "@plugins/tasks/plugins/task-ids/core";
import { TaskDecisions } from "@plugins/tasks/plugins/decisions/web";

/**
 * The tray's decisions beside the conversation instead of over its
 * composer: one column, the conversation's task's decisions unframed.
 */
export const convDecisionsPane = Pane.define({
  route: defineRoute({
    id: "conv-decisions",
    segment: "agent-decisions;conv",
  }),
  // The conversation it is about — omitted from the URL beside that
  // conversation's own column, written (`;conv=`) anywhere else.
  implied: { conv: impliedBy(conversationRoute, sameAs("convId")) },
  app: agentManagerApp,
  title: "Decisions",
  component: ConvDecisionsBody,
  // Conversation-scoped satellite: it stays a column beside its
  // conversation (Open in Decisions is the inbox of its own).
  chrome: { history: false, promote: false },
});

function ConvDecisionsBody(): ReactElement {
  const { conv } = convDecisionsPane.useParams();
  const conversation = useConversationById(conv);
  return (
    <PaneChrome pane={convDecisionsPane} inset="document">
      {conversation.status === "loading" ? (
        <Loading variant="rows" count={2} />
      ) : conversation.status === "error" ? (
        <ResourceErrorInline
          variant="block"
          subject="the conversation"
          error={conversation.error}
          refetch={conversation.refetch}
        />
      ) : conversation.found ? (
        <TaskDecisions taskId={taskIdKind.parse(conversation.row.taskId)} />
      ) : (
        <Text tone="muted">This conversation no longer exists.</Text>
      )}
    </PaneChrome>
  );
}
