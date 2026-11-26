import { Pane, defineRoute } from "@plugins/primitives/plugins/pane/web";
import { useLive } from "@plugins/network/plugins/live/web";
import { mailApp } from "@plugins/apps/plugins/mail/plugins/shell/core";
import { mailThread } from "@plugins/apps/plugins/mail/plugins/reader/core";
import { ThreadReader } from "@plugins/apps/plugins/mail/plugins/reader/web";
import { MailScreen } from "./components/mail-screen";

const mailThreadsRoute = defineRoute({ id: "mail-threads", segment: "" });

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
  route: defineRoute({ id: "mail-thread", segment: "thread/:threadId" }),
  app: mailApp,
  companion: true,
  useResolve: false,
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
  return <ThreadReader threadId={threadId} onClose={close} />;
}
