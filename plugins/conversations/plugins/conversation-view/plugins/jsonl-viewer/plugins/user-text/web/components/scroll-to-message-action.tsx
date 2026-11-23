import {
  rowAction,
  type RowAction,
} from "@plugins/conversations/plugins/conversation-view/plugins/jsonl-viewer/plugins/row-actions/web";
import type { JsonlEvent } from "@plugins/conversations/plugins/transcript-source/core";
import { useSectionStart } from "@plugins/conversations/plugins/conversation-view/plugins/jsonl-viewer/web";
import { symbol } from "@plugins/ui/plugins/icons/core";

const verticalAlignTopIcon = symbol("vertical-align-top");

/**
 * Jump back to where a prompt starts. Offered only while that start is above
 * the viewport — the prompt pinned over the turn it opened, or expanded and
 * read past its top: a prompt sitting at its own place has nowhere to jump to.
 */
function useScrollToMessageAction(event: JsonlEvent): RowAction | null {
  const start = useSectionStart();
  if (event.kind !== "user-text" || start === null || !start.scrolledPast)
    return null;
  return {
    kind: "button",
    icon: verticalAlignTopIcon,
    label: "Scroll to this message",
    onClick: start.jump,
  };
}

export function ScrollToMessageAction({ event }: { event: JsonlEvent }) {
  return rowAction(useScrollToMessageAction(event));
}
