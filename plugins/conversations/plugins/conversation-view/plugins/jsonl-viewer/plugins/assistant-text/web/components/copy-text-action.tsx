import {
  rowAction,
  useCopyAction,
} from "@plugins/conversations/plugins/conversation-view/plugins/jsonl-viewer/plugins/row-actions/web";
import type { JsonlEvent } from "@plugins/conversations/plugins/transcript-source/core";

function useCopyAssistantTextAction(event: JsonlEvent) {
  return useCopyAction(
    event.kind === "assistant-text" ? event.text : null,
    "Copy message",
  );
}

export function CopyAssistantTextAction({ event }: { event: JsonlEvent }) {
  return rowAction(useCopyAssistantTextAction(event));
}
