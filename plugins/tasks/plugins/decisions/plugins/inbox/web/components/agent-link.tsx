import type { ReactElement } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import { foldResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import { useOpenPane } from "@plugins/primitives/plugins/pane/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Button, cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import {
  RowActions,
  rowActionsAnchor,
} from "@plugins/primitives/plugins/row-actions/web";
import { activationProps } from "@plugins/primitives/plugins/link-gesture/web";
import { conversationPane } from "@plugins/conversations/plugins/conversation-view/web";
import { taskDetailPane } from "@plugins/tasks/plugins/task-detail/web";
import { decisionAgent } from "@plugins/tasks/plugins/decisions/core";
import { navIcons, symbol } from "@plugins/ui/plugins/icons/core";

const chatIcon = symbol("chat");

/**
 * The agent asking a decision, as the conversation answers are typed into:
 * `{ convId }` once read, `none` when no agent ever ran on the task (or no
 * computer can say), `loading` until then, the read's failure as itself.
 */
type AgentConversation =
  | { kind: "loading" }
  | { kind: "conversation"; convId: string }
  | { kind: "none" }
  | { kind: "error"; message: string };

function useAgentConversation(taskId: string): AgentConversation {
  return foldResource(useLive(decisionAgent, { taskId }), {
    loading: (): AgentConversation => ({ kind: "loading" }),
    error: (error) => ({ kind: "error", message: error.message }),
    unavailable: (): AgentConversation => ({ kind: "none" }),
    ready: (agent) =>
      agent === null
        ? { kind: "none" }
        : { kind: "conversation", convId: agent.conversationId },
  });
}

/**
 * The decision detail's agent line: the agent's title opening its
 * conversation beside the decision, and on hover an Expand opening that
 * conversation on its own. A task no agent ran on links to the task instead.
 */
export function AgentLink({
  taskId,
  title,
  className,
}: {
  taskId: string;
  title: string;
  className?: string;
}): ReactElement {
  const openPane = useOpenPane();
  const agent = useAgentConversation(taskId);
  if (agent.kind === "loading")
    return (
      <Button variant="ghost" className={className} disabled>
        {title}
      </Button>
    );
  if (agent.kind === "error")
    return (
      <Text variant="caption" tone="destructive" className={className}>
        {`Could not read ${title}'s conversation: ${agent.message}`}
      </Text>
    );
  if (agent.kind === "none")
    return (
      <Button
        variant="ghost"
        className={className}
        {...activationProps(
          openPane.to(taskDetailPane, { taskId }, { mode: "push" }),
        )}
      >
        {title}
      </Button>
    );
  const { convId } = agent;
  return (
    <Line className={cn(rowActionsAnchor, "gap-xs", className)}>
      <Button
        variant="ghost"
        {...activationProps(
          openPane.to(conversationPane, { convId }, { mode: "push" }),
        )}
      >
        {title}
      </Button>
      <RowActions pin={null}>
        <IconButton
          icon={navIcons.expand}
          label="Open conversation"
          {...activationProps(
            openPane.to(conversationPane, { convId }, { mode: "root" }),
          )}
        />
      </RowActions>
    </Line>
  );
}

/**
 * A group header's Open conversation (the inbox grouped by agent): opens the
 * agent's conversation beside the list. Nothing until the conversation is
 * known, or when there is none to open.
 */
export function AgentConversationAction({
  taskId,
  title,
}: {
  taskId: string;
  title: string;
}): ReactElement | null {
  const openPane = useOpenPane();
  const agent = useAgentConversation(taskId);
  if (agent.kind !== "conversation") return null;
  return (
    <IconButton
      icon={chatIcon}
      label={`Open ${title}'s conversation`}
      // The header's own click folds the section: this click is the link's.
      {...activationProps(
        openPane.to(
          conversationPane,
          { convId: agent.convId },
          { mode: "push" },
        ),
        { isolate: true },
      )}
    />
  );
}
