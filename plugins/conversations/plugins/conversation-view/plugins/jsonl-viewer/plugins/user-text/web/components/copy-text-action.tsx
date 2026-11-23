import {
  rowAction,
  useCopyAction,
} from "@plugins/conversations/plugins/conversation-view/plugins/jsonl-viewer/plugins/row-actions/web";
import type { JsonlEvent } from "@plugins/conversations/plugins/transcript-source/core";

function useCopyUserTextAction(event: JsonlEvent) {
  return useCopyAction(
    event.kind === "user-text" ? event.text : null,
    "Copy message",
  );
}

export function CopyUserTextAction({ event }: { event: JsonlEvent }) {
  return rowAction(useCopyUserTextAction(event));
}
