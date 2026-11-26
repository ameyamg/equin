import { useSyncExternalStore } from "react";
import { z } from "zod";
import { defineStore } from "@plugins/primitives/plugins/dom/plugins/web-storage/web";
import { DEFAULT_DRAFT_TTL } from "@plugins/primitives/plugins/kept-state/web";

/**
 * A decision's first question while it is typed, one entry per decision
 * (`useDraft`'s `scope`): a reload keeps it. Once the chat has started, the
 * thread's composer keeps its own draft.
 */
export const decisionAskQuestionDraft = defineStore<string>({
  owner: "tasks.decisions.ask.question",
  pageWide: {
    reason:
      "keyed by decision id: the same decision's chat in the inbox, the tray and a page block shares one draft",
  },
  label: "Decision chat questions",
  area: "local",
  cap: "64 KB",
  ttl: DEFAULT_DRAFT_TTL,
  whenFull: "refuse",
  schema: z.string(),
});

// Whether a decision's chat is open, per decision, for the page: the toggle
// (AnswerAction) and the thread (AboveAnswer) render in two slots, so two
// component trees share it here. Not kept across reloads: the thread is, and
// its toggle shows a dot for it.
const open = new Map<string, boolean>();
const listeners = new Map<string, Set<() => void>>();

export function setChatOpen(decisionId: string, value: boolean): void {
  if ((open.get(decisionId) ?? false) === value) return;
  open.set(decisionId, value);
  listeners.get(decisionId)?.forEach((l) => l());
}

export function useChatOpen(decisionId: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      let set = listeners.get(decisionId);
      if (!set) {
        set = new Set();
        listeners.set(decisionId, set);
      }
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    },
    () => open.get(decisionId) ?? false,
    () => false,
  );
}
