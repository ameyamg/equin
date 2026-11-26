import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Pane } from "@plugins/primitives/plugins/pane/web";
import { mailThreadPane, mailThreadsPane } from "./panes";

export default {
  description:
    "Mail's index pane (/mail): one DataView over the live mail.threads window — rows are threads, newest first, grouped by received day, searched by the provider's own search (the query column) — whose views are the built-ins (Inbox, Sent, Drafts, Done, Spam, Trash: locked, copy-only, code-defined, the Inbox filter in one place for the boot preload), one per user label (a parent's includes its sub-labels) and the user's own saved views. The mail sidebar is the DataView's aside: the view name, one drag-reorderable list of views (Spam and Trash folded under More), + New view, and the label tree (folds roll unread up). The toolbar is the search box with Filter and Display inside it, and the view's rules as chips while it is the user's own or edited. A refused window renders by its code: not connected draws the provider's connect surface.",
  contributions: [
    Pane.Register({ pane: mailThreadsPane }),
    Pane.Register({ pane: mailThreadPane }),
  ],
  slots: { mail: mailThreadsPane, "mail-thread": mailThreadPane },
} satisfies PluginDefinition;
