import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Pane } from "@plugins/primitives/plugins/pane/web";
import { mailThreadPane, mailThreadsPane } from "./panes";
import { ThreadItemActions } from "./slots";
import { RowTriage } from "./components/thread-triage";

export default {
  description:
    "Mail's index pane (/mail): one DataView over the live mail.threads window — rows are threads, newest first, grouped by received day, searched by the provider's own search (the query column) — whose views are the built-ins (Inbox, Sent, Drafts, Done, Spam, Trash: locked, copy-only, code-defined, the Inbox filter in one place for the boot preload), one per user label (a parent's includes its sub-labels) and the user's own saved views. The mail sidebar is the DataView's aside: the view name, one drag-reorderable list of views (Spam and Trash folded under More), + New view, and the label tree (folds roll unread up). The toolbar is the search box with Filter and Display inside it, and the view's rules as chips while it is the user's own or edited. A refused window renders by its code: not connected draws the provider's connect surface. Triage: each row's hover actions (Label, Delete, Done — Restore in the trash, Not spam in spam, Move to Inbox elsewhere), checkbox selection with a bottom selection bar (Done, Label, Mark as read, Delete / Restore), the reader's bar (the same, plus Mark as unread), a thread marked read when opened, undo toasts, and the keys j / k (next / previous thread), e (the primary action), # (delete) and / (search) — every op drawn at once on every view through the live row overlay and written through the cache. Labels: Label as (the tree, checked when every thread has it, New label with a / path), and rename / delete in the sidebar's label menu.",
  contributions: [
    Pane.Register({ pane: mailThreadsPane }),
    Pane.Register({ pane: mailThreadPane }),
    ThreadItemActions({ id: "triage", component: RowTriage }),
  ],
  slots: {
    mail: mailThreadsPane,
    "mail-thread": mailThreadPane,
    "thread-actions": ThreadItemActions,
  },
} satisfies PluginDefinition;
