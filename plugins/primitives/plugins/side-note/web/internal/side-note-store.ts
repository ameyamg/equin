import { useSyncExternalStore } from "react";

/**
 * A side note as the page holds it, shared by the editor and the
 * toolbar toggle (two slots, so two component trees):
 * - `open`: the user opened the note with the toggle (an empty one shows only
 *   then);
 * - `draft`: the editor's live text, ahead of the debounced save — undefined
 *   while no editor holds one.
 */
interface NoteUi {
  open: boolean;
  draft: string | undefined;
}

const CLOSED: NoteUi = { open: false, draft: undefined };

const state = new Map<string, NoteUi>();
const listeners = new Map<string, Set<() => void>>();

function get(subject: string): NoteUi {
  return state.get(subject) ?? CLOSED;
}

function update(subject: string, patch: Partial<NoteUi>): void {
  const prev = get(subject);
  const next = { ...prev, ...patch };
  if (next.open === prev.open && next.draft === prev.draft) return;
  state.set(subject, next);
  listeners.get(subject)?.forEach((l) => l());
}

export function setOpen(subject: string, open: boolean): void {
  update(subject, { open });
}

export function setDraft(subject: string, draft: string | undefined): void {
  update(subject, { draft });
}

export function useNoteUi(subject: string): NoteUi {
  return useSyncExternalStore(
    (cb) => {
      let set = listeners.get(subject);
      if (!set) {
        set = new Set();
        listeners.set(subject, set);
      }
      set.add(cb);
      return () => {
        set!.delete(cb);
      };
    },
    () => get(subject),
    () => CLOSED,
  );
}
