import { useEffect, useRef } from "react";
import { Pane } from "@plugins/primitives/plugins/pane/web";
import {
  mailThreads,
  primaryMailAction,
  type MailThreadOp,
} from "@plugins/apps/plugins/mail/plugins/cache/core";
import { PLAIN_GESTURE } from "@plugins/primitives/plugins/link-gesture/core";
import { useSurfaceShortcuts } from "@plugins/primitives/plugins/shortcuts/web";
import { ThreadActions, useMailActions } from "./internal/actions";
import { rowOrStale, useLive } from "@plugins/network/plugins/live/web";
import { foldResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  mailApp,
  mailThreadRoute,
  mailThreadsRoute,
} from "@plugins/apps/plugins/mail/plugins/shell/core";
import { mailThread } from "@plugins/apps/plugins/mail/plugins/reader/core";
import { ThreadReader } from "@plugins/apps/plugins/mail/plugins/reader/web";
import { ReplyBox } from "@plugins/apps/plugins/mail/plugins/compose/web";
import { mailAccountStatus } from "@plugins/apps/plugins/mail/plugins/cache/core";
import { labelChips, MailScreen } from "./components/mail-screen";
import { LabelChip, threadLabelChips } from "./components/thread-row";
import { useMailboxes } from "./internal/mailboxes";
import { Cluster } from "@plugins/primitives/plugins/css/plugins/cluster/web";

/**
 * Mail's index pane — what bare `/mail` shows: the threads list with the mail
 * sidebar beside it, full-surface (no pane header: the sidebar names the
 * active view). The active view is in the URL (`;view.mail.threads=<id>`).
 */
export const mailThreadsPane = Pane.define({
  title: mailApp.name,
  route: mailThreadsRoute,
  app: mailApp,
  appIndex: true,
  component: MailScreen,
});

/**
 * One thread, open beside the list: `/mail/thread/<id>` (the reader's
 * `ThreadReader` over `mail.thread`). A companion: at the route's head the
 * app's index pane (the list) stays to its left — the index has no URL part,
 * so it is never a column of the route itself — and closing it returns to the
 * list alone. The row opened is the list's selected row. No resolve gate:
 * the reader says loading, gone or not connected itself.
 */
export const mailThreadPane = Pane.define({
  route: mailThreadRoute,
  app: mailApp,
  companion: true,
  useResolve: false,
  // Below a 1080px row the reader lies over the list, right of the sidebar
  // (its overlay-start anchor), as the prototype's `.pane` does — the list
  // keeps the row's whole width under it.
  chrome: { overlayBelow: 1080 },
  title: { useText: useThreadTitle, fallback: "Conversation" },
  component: MailThreadPaneView,
});

function useThreadTitle({
  threadId,
}: {
  threadId: string;
}): string | undefined {
  const read = useLive(mailThread, { id: threadId });
  if (read.status === "ready") {
    return read.data.subject === "" ? "(no subject)" : read.data.subject;
  }
  // Loading or failed: the pane's own body says which; the title waits.
  return undefined;
}

function MailThreadPaneView() {
  const { threadId } = mailThreadPane.useParams();
  // Null for the frame a swap to another thread is in flight (the route's
  // head is moving): the reader then draws no Close.
  const close = mailThreadPane.useClose();
  // The thread's row (by id: the prediction of an op in flight included):
  // what its actions read — and, unread, it is marked read as it opens.
  const read = useLive(mailThreads, { id: threadId });
  // Not known yet and gone draw the same: no actions (the reader says which).
  const row = rowOrStale(read) ?? null;
  const { run } = useMailActions();
  const markedFor = useRef<string | null>(null);
  useEffect(() => {
    if (row === null || markedFor.current === row.id) return;
    markedFor.current = row.id;
    if (row.unread)
      run([row.id], { kind: "read", unread: false }, { toast: false });
  }, [row, run]);
  // Done, Delete and the rest move the thread away: back to the list.
  const leave = close === null ? undefined : () => close(PLAIN_GESTURE);
  const act = (op: MailThreadOp) => {
    if (row === null) return;
    run([row.id], op);
    leave?.();
  };
  // e: the primary action (Done in the inbox); #: delete — on the open thread.
  useSurfaceShortcuts([
    {
      id: "mail.primary",
      keys: "e",
      label: "Done (the open thread's primary action)",
      group: "Mail",
      when: () => row !== null,
      handler: () => {
        if (row !== null) act({ kind: primaryMailAction(row.mailboxes).op });
      },
    },
    {
      // Where "#" is unshifted (UK layouts).
      id: "mail.trash-unshifted",
      keys: "#",
      label: "Delete the open thread",
      group: "Mail",
      when: () => row !== null,
      handler: () => act({ kind: "trash" }),
    },
    {
      id: "mail.trash",
      keys: "shift+#",
      label: "Delete the open thread",
      group: "Mail",
      when: () => row !== null,
      handler: () => act({ kind: "trash" }),
    },
  ]);
  const status = useLive(mailAccountStatus);
  // Only the reply box's wording reads it ("Follow up" on your own message).
  const me = foldResource(status, {
    loading: () => null,
    error: () => null,
    ready: (s) => (s.kind === "none" ? null : s.address),
  });
  // The thread's user labels, as its rows show them. Until the labels are
  // read (or when that read failed — the sidebar says so, with Retry) the
  // reader draws none.
  const { state: mailboxes } = useMailboxes();
  const chips =
    row === null || mailboxes.kind !== "ready"
      ? []
      : threadLabelChips(row.mailboxes, labelChips(mailboxes.mailboxes));
  return (
    <ThreadReader
      threadId={threadId}
      onClose={close}
      labels={
        chips.length === 0 ? undefined : (
          <Cluster gap="xs">
            {chips.map((c) => (
              <LabelChip key={c.id} name={c.name} color={c.color} />
            ))}
          </Cluster>
        )
      }
      footer={(thread) => <ReplyBox key={thread.id} thread={thread} me={me} />}
      tools={
        row === null ? null : (
          <ThreadActions row={row} place="reader" onLeave={leave} />
        )
      }
    />
  );
}
