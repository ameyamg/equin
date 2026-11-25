import type { ReactElement } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Badge } from "@plugins/primitives/plugins/css/plugins/badge/web";
import type { ConversationItemConv } from "@plugins/conversations/plugins/conversation-ui/plugins/item/web";
import { decisionsList } from "@plugins/tasks/plugins/decisions/core";
import { taskIdKind } from "@plugins/tasks/plugins/task-ids/core";

/**
 * How many of a conversation's task's decisions need the user, as a chip on
 * its row: the exact count of its task's Needs you decisions (one count per
 * row on screen — a grouping over every task would stop at its group cap and
 * read a task past it as zero). Nothing while unknown or zero.
 */
export function DecisionsItemChip({
  conv,
}: {
  conv: ConversationItemConv;
}): ReactElement | null {
  const needs = useLive(
    decisionsList,
    conv.taskId == null
      ? null
      : {
          count: true,
          where: { taskId: taskIdKind.parse(conv.taskId), tab: "needs" },
        },
  );
  if (needs === null || needs.status === "loading") return null;
  if (needs.status === "error")
    return (
      <ResourceErrorInline
        variant="icon"
        subject="the decisions that need you"
        error={needs.error}
        refetch={needs.refetch}
      />
    );
  const count = needs.data;
  if (count === 0) return null;
  const words = `${count} decision${count === 1 ? " needs" : "s need"} you`;
  return (
    <Badge variant="primary" tooltip={words} aria-label={words}>
      {count}
    </Badge>
  );
}
