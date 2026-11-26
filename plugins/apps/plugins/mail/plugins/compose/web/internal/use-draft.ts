import { useCallback, useEffect, useRef, useState } from "react";
import { useFetchEndpoint } from "@plugins/infra/plugins/endpoints/web";
import { useLive } from "@plugins/network/plugins/live/web";
import { uploadAttachment } from "@plugins/infra/plugins/attachments/web";
import { useToast } from "@plugins/shell/plugins/notifications/web";
import {
  discardMailDraft,
  isDraftEmpty,
  MAIL_ATTACHMENTS_MAX_BYTES,
  mailDraftIdKind,
  mailSignature,
  saveMailDraft,
  sendMailDraft,
  startMailDraft,
  type DraftContent,
  type DraftStart,
  type MailDraft,
} from "../../core";
import { useComposeActions } from "./windows";

/** How long the editor waits after a keystroke before it saves (the server mirrors to the provider after its own settle). */
const SAVE_QUIET_MS = 700;

/** Starts a draft (blank, a reply, a forward, or the continuation of a draft message) under a fresh id; answers it as saved. */
export function useStartDraft(): (start: DraftStart) => Promise<MailDraft> {
  const fetchEndpoint = useFetchEndpoint();
  return useCallback(
    (start: DraftStart) =>
      fetchEndpoint(
        startMailDraft,
        {},
        { body: { id: mailDraftIdKind.mint(), start } },
      ),
    [fetchEndpoint],
  );
}

/** Opens a compose window on a new draft, a forward, or a draft continued. */
export function useOpenCompose(): (start: DraftStart) => Promise<void> {
  const startDraft = useStartDraft();
  const { open } = useComposeActions();
  const toast = useToast();
  return useCallback(
    async (start: DraftStart) => {
      try {
        const d = await startDraft(start);
        open(d.id);
      } catch (err) {
        toast({
          type: "mail-compose-failed",
          title: "Could not start the message",
          description: err instanceof Error ? err.message : String(err),
          category: "other",
          variant: "error",
        });
      }
    },
    [startDraft, open, toast],
  );
}

/** The account's signature as an editor reads it (`mail.signature`). */
export type SignatureRead = ReturnType<typeof useMailSignature>;

/**
 * The account's signature, read from the provider when the editor opens (its
 * settings have no change signal): one read per editor, shared by the block
 * under the body and the footer's Add signature.
 */
export function useMailSignature() {
  return useLive(mailSignature);
}

export type DraftEditor = {
  /** The server's draft, as it is now (its state, its last send's failure). */
  draft: MailDraft;
  content: DraftContent;
  update: (patch: Partial<DraftContent>) => void;
  /** Saves what is typed now (no quiet wait). */
  save: () => Promise<void>;
  addFiles: (files: readonly File[]) => Promise<void>;
  removeAttachment: (index: number) => void;
  /** Saves, then queues the send (the outbox pill takes over); rejects with the server's reason. */
  send: () => Promise<void>;
  /** Saves and lets go (an empty draft is discarded instead); answers whether a draft was kept. */
  close: () => Promise<"kept" | "discarded">;
  discard: () => Promise<void>;
};

/**
 * One draft as an open editor holds it: the server's copy (`draft`, read by
 * the caller) seeds the fields once, then the editor's own state is the
 * truth while it is open — every change saved after a short quiet (and on
 * close, send and unmount), one save at a time, in order. A failed save says
 * so in a toast.
 */
export function useDraftEditor(draft: MailDraft): DraftEditor {
  const id = draft.id;
  const fetchEndpoint = useFetchEndpoint();
  const toast = useToast();
  const { sent } = useComposeActions();
  const [content, setContent] = useState<DraftContent>(draft.content);
  const latest = useRef<DraftContent>(draft.content);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const failed = useCallback(
    (what: string, err: unknown) =>
      toast({
        type: "mail-draft-failed",
        title: `Could not ${what} the draft`,
        description: err instanceof Error ? err.message : String(err),
        category: "other",
        variant: "error",
      }),
    [toast],
  );

  /** Runs `fn` after every earlier write (whatever they answered: each reported its own failure). */
  const queue = useCallback((fn: () => Promise<unknown>): Promise<void> => {
    const run = async () => {
      await fn();
    };
    const p = chain.current.then(run, run);
    chain.current = p;
    return p;
  }, []);

  const flush = useCallback((): Promise<void> => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return chain.current;
    dirty.current = false;
    const c = latest.current;
    const p = queue(() =>
      fetchEndpoint(saveMailDraft, { id }, { body: { content: c } }),
    );
    p.catch((err: unknown) => failed("save", err));
    return p;
  }, [fetchEndpoint, failed, id, queue]);

  const change = useCallback(
    (next: (c: DraftContent) => DraftContent) => {
      const n = next(latest.current);
      latest.current = n;
      setContent(n);
      dirty.current = true;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_QUIET_MS);
    },
    [flush],
  );

  // Leaving (the window closed, the reader moved on, the tab closed) saves
  // what is typed.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flush();
    };
  }, [flush]);

  /** No save pending or in flight: what follows is the last write. */
  const settleSaves = async () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    dirty.current = false;
    await chain.current;
  };

  return {
    draft,
    content,
    update: (patch) => change((c) => ({ ...c, ...patch })),
    save: flush,
    addFiles: async (files) => {
      const total =
        latest.current.attachments.reduce((n, a) => n + a.size, 0) +
        files.reduce((n, f) => n + f.size, 0);
      if (total > MAIL_ATTACHMENTS_MAX_BYTES) {
        throw new Error(
          `A message carries at most ${MAIL_ATTACHMENTS_MAX_BYTES / 1024 / 1024} MB of files.`,
        );
      }
      for (const f of files) {
        const mimeType = f.type || "application/octet-stream";
        const up = await uploadAttachment(fetchEndpoint, f, f.name, mimeType, {
          maxBytes: MAIL_ATTACHMENTS_MAX_BYTES,
        });
        change((c) => ({
          ...c,
          attachments: [
            ...c.attachments,
            {
              kind: "upload",
              attachmentId: up.id,
              filename: f.name,
              mimeType,
              size: f.size,
            },
          ],
        }));
      }
      // Linked at once, so the attachments sweep keeps them.
      await flush();
    },
    removeAttachment: (index) =>
      change((c) => ({
        ...c,
        attachments: c.attachments.filter((_, i) => i !== index),
      })),
    send: async () => {
      await settleSaves();
      try {
        await fetchEndpoint(
          sendMailDraft,
          { id },
          { body: { content: latest.current } },
        );
      } catch (err) {
        // Not taken (no recipient, a bad address): what is typed is still
        // unsaved — the next close, quiet or leave saves it.
        dirty.current = true;
        throw err;
      }
      sent(id);
    },
    close: async () => {
      if (isDraftEmpty(latest.current)) {
        await settleSaves();
        await fetchEndpoint(discardMailDraft, { id });
        return "discarded";
      }
      await flush();
      return "kept";
    },
    discard: async () => {
      await settleSaves();
      await fetchEndpoint(discardMailDraft, { id });
    },
  };
}
