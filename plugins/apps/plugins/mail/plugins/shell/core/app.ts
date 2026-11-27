import { defineApp, defineRoute } from "@plugins/primitives/plugins/pane/core";
import { symbol } from "@plugins/ui/plugins/icons/core";

/**
 * The Mail app (rebuild). Dark only: the approved prototype
 * (proto-1795656296-rtsmk5) is a dark mailbox, so the app declares the scheme
 * rather than its theme spelling dark values group by group. Listed for
 * every user: with no account connected it draws its provider's connect
 * surface.
 */
export const mailApp = defineApp({
  id: "mail",
  name: "Mail",
  basePath: "/mail",
  icon: symbol("mail"),
  category: ["Office", "Documents"],
  colorMode: "dark",
});

/** Mail's index: the threads list (bare `/mail`). */
export const mailThreadsRoute = defineRoute({
  id: "mail-threads",
  segment: "",
});

/** One thread open beside the list: `/mail/thread/<id>`. */
export const mailThreadRoute = defineRoute({
  id: "mail-thread",
  segment: "thread/:threadId",
});
