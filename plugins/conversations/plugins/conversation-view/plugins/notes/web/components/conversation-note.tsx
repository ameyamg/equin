import { useCallback, type ReactElement } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import { useFetchEndpoint } from "@plugins/infra/plugins/endpoints/web";
import {
  SideNoteArea,
  SideNoteToggle,
} from "@plugins/primitives/plugins/side-note/web";
import type { Conversation as ConversationRecord } from "@plugins/tasks/plugins/tasks-core/core";
import { conversationNoteRows } from "../../shared";
import { deleteNote, upsertNote } from "../internal/api";

const subjectOf = (conversationId: string): string =>
  `conversation:${conversationId}`;

/** The conversation's note editor, above the prompt. */
export function NotesArea({
  conversation,
}: {
  conversation: ConversationRecord;
}): ReactElement | null {
  const conversationId = conversation.id;
  const fetchEndpoint = useFetchEndpoint();
  const read = useLive(conversationNoteRows, { id: conversationId });
  const save = useCallback(
    async (next: string) => {
      if (next.trim() === "") await deleteNote(fetchEndpoint, conversationId);
      else await upsertNote(fetchEndpoint, conversationId, next);
    },
    [conversationId, fetchEndpoint],
  );
  return (
    <SideNoteArea
      subject={subjectOf(conversationId)}
      read={read}
      save={save}
      keepField="conversation-notes.note"
      ariaLabel="Conversation notes"
    />
  );
}

/** The note's toggle, in the prompt bar. */
export function NotesToggleButton({
  conversation,
}: {
  conversation: ConversationRecord;
}): ReactElement | null {
  const read = useLive(conversationNoteRows, { id: conversation.id });
  return <SideNoteToggle subject={subjectOf(conversation.id)} read={read} />;
}
