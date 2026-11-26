import { useMemo } from "react";
import { defineScopedStore } from "@plugins/primitives/plugins/scope/plugins/scoped-store/web";
import type { MailDraftId } from "../../core";

// The Mail surface's compose state (one per Mail surface: the store's
// Provider is the layout's): the open compose windows (bottom right, the
// newest last) and the drafts sent from this surface whose send has not landed
// (the outbox pill). The drafts themselves are the server's (`mail.draft`);
// this holds only which are shown.

export type ComposeWindow = { id: MailDraftId; minimized: boolean };

export type ComposeState = {
  windows: readonly ComposeWindow[];
  /** Drafts sent from this surface whose send has not landed yet. */
  sending: readonly MailDraftId[];
};

export const ComposeStore = defineScopedStore<ComposeState>({
  windows: [],
  sending: [],
});

/** The most compose windows open at once; opening another closes the oldest (its draft is kept). */
const WINDOWS_MAX = 3;

export type ComposeActions = {
  open: (id: MailDraftId) => void;
  close: (id: MailDraftId) => void;
  toggleMinimized: (id: MailDraftId) => void;
  /** A send queued from this surface: drawn as the outbox pill until it lands or is undone. */
  sent: (id: MailDraftId) => void;
  settled: (id: MailDraftId) => void;
};

export function useComposeActions(): ComposeActions {
  const store = ComposeStore.useStoreApi();
  return useMemo(
    () => ({
      open: (id) =>
        store.setState((s) => ({
          ...s,
          windows: [
            ...s.windows.filter((w) => w.id !== id),
            { id, minimized: false },
          ].slice(-WINDOWS_MAX),
        })),
      close: (id) =>
        store.setState((s) => ({
          ...s,
          windows: s.windows.filter((w) => w.id !== id),
        })),
      toggleMinimized: (id) =>
        store.setState((s) => ({
          ...s,
          windows: s.windows.map((w) =>
            w.id === id ? { ...w, minimized: !w.minimized } : w,
          ),
        })),
      sent: (id) =>
        store.setState((s) => ({
          ...s,
          sending: [...s.sending.filter((x) => x !== id), id],
        })),
      settled: (id) =>
        store.setState((s) => ({
          ...s,
          sending: s.sending.filter((x) => x !== id),
        })),
    }),
    [store],
  );
}
