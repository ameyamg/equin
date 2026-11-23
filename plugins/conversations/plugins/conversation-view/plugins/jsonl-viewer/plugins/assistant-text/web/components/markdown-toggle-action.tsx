import {
  rowAction,
  type RowAction,
} from "@plugins/conversations/plugins/conversation-view/plugins/jsonl-viewer/plugins/row-actions/web";
import type { JsonlEvent } from "@plugins/conversations/plugins/transcript-source/core";
import { useRowMarkdown } from "@plugins/conversations/plugins/conversation-view/plugins/jsonl-viewer/web";
import { symbol } from "@plugins/ui/plugins/icons/core";

const codeIcon = symbol("code");

function useMarkdownToggleAction(event: JsonlEvent): RowAction | null {
  const { markdownMode, setMarkdownMode } = useRowMarkdown();
  if (event.kind !== "assistant-text") return null;
  return {
    kind: "button",
    icon: codeIcon,
    label: markdownMode ? "View markdown source" : "Render markdown",
    active: !markdownMode,
    onClick: () => setMarkdownMode(!markdownMode),
  };
}

export function MarkdownToggleAction({ event }: { event: JsonlEvent }) {
  return rowAction(useMarkdownToggleAction(event));
}
