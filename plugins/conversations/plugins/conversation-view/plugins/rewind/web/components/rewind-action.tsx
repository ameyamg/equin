import {
  rowAction,
  type RowAction,
} from "@plugins/conversations/plugins/conversation-view/plugins/jsonl-viewer/plugins/row-actions/web";
import type { JsonlEvent } from "@plugins/conversations/plugins/transcript-source/core";
import { conversationPane } from "@plugins/conversations/plugins/conversation-view/web";
import { useSetConversationPromptDraft } from "@plugins/conversations/plugins/conversation-view/plugins/prompt-input/web";
import { useGoBackToMessage, type RewindMode } from "../hooks/use-go-back";
import type { IconRef } from "@plugins/ui/plugins/icons/core";
import { symbol } from "@plugins/ui/plugins/icons/core";

const MODES: Record<RewindMode, { title: string; icon: IconRef }> = {
  rewind: { title: "Rewind to here", icon: symbol("undo") },
  fork: { title: "Fork from here", icon: symbol("call-split") },
};

/**
 * On each of the user's own messages: go back to just before it, either in this
 * conversation (Rewind to here) or in a new one (Fork from here) — two actions,
 * one per mode. Declared as data, so whichever the row-actions config puts behind
 * the `⋯` (Fork from here, by default) reads there as a labelled row. The
 * message's text lands in the prompt editor either way, ready to be rewritten.
 */
function useGoBackAction(
  event: JsonlEvent,
  mode: RewindMode,
): RowAction | null {
  const { convId } = conversationPane.useParams();
  const setConversationPromptDraft = useSetConversationPromptDraft();
  const { available, busy, run } = useGoBackToMessage({
    convId,
    uuid: event.kind === "user-text" ? event.uuid : undefined,
    onBack: setConversationPromptDraft,
  });

  if (!available) return null;

  const { title, icon } = MODES[mode];
  return {
    kind: "button",
    icon,
    label: title,
    disabled: busy,
    onClick: () => void run(mode),
  };
}

function useRewindAction(event: JsonlEvent): RowAction | null {
  return useGoBackAction(event, "rewind");
}

function useForkFromMessageAction(event: JsonlEvent): RowAction | null {
  return useGoBackAction(event, "fork");
}

export function RewindAction({ event }: { event: JsonlEvent }) {
  return rowAction(useRewindAction(event));
}

export function ForkFromMessageAction({ event }: { event: JsonlEvent }) {
  return rowAction(useForkFromMessageAction(event));
}
