import type { JsonlEvent } from "@plugins/conversations/plugins/transcript-source/core";
import { rowAction } from "@plugins/conversations/plugins/conversation-view/plugins/jsonl-viewer/plugins/row-actions/web";

export function TimestampAction({ event }: { event: JsonlEvent }) {
  return rowAction({ kind: "time", at: event.at });
}
