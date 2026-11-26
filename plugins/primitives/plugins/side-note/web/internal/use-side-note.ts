import { useCallback } from "react";
import type { LiveRowResult } from "@plugins/network/plugins/live/web";
import { setOpen, useNoteUi } from "./side-note-store";

/** A note's saved row: what its owner's live read returns. */
export interface SideNoteRow {
  notes: string;
}

export interface SideNoteState {
  /** The saved note: "" until the row is ready, and when there is none. */
  saved: string;
  /** The note has text — the editor's live draft when one is held, else the saved note. */
  hasText: boolean;
  /** A note with text always shows; an empty one only while opened. */
  isVisible: boolean;
  /** Opens or hides an empty note; a note with text cannot be hidden. */
  toggleVisible: () => void;
}

/**
 * One note's state, shared by its toggle and its editor through `subject`.
 * `read` is the owner's live read of the note row (`found: false`: no note).
 */
export function useSideNote({
  subject,
  read,
}: {
  subject: string;
  read: LiveRowResult<SideNoteRow>;
}): SideNoteState {
  const saved = read.status === "ready" && read.found ? read.row.notes : "";
  const { open, draft } = useNoteUi(subject);
  const hasText = read.status === "ready" && (draft ?? saved).trim() !== "";
  const toggleVisible = useCallback(() => {
    if (!hasText) setOpen(subject, !open);
  }, [subject, hasText, open]);
  return { saved, hasText, isVisible: hasText || open, toggleVisible };
}
