import {
  rowAction,
  useCopyAction,
} from "@plugins/conversations/plugins/conversation-view/plugins/jsonl-viewer/plugins/row-actions/web";
import type { JsonlEvent } from "@plugins/conversations/plugins/transcript-source/core";

function useCopyToolResultAction(event: JsonlEvent) {
  return useCopyAction(
    event.kind === "tool-call" && event.result ? event.result.content : null,
    "Copy result",
  );
}

export function CopyToolResultAction({ event }: { event: JsonlEvent }) {
  return rowAction(useCopyToolResultAction(event));
}
