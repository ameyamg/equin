import { defineApp } from "@plugins/primitives/plugins/pane/core";
import { symbol } from "@plugins/ui/plugins/icons/core";

/**
 * The Mail app (rebuild). Dark only: the approved prototype
 * (proto-1795656296-rtsmk5) is a dark mailbox, so the app declares the scheme
 * rather than its theme spelling dark values group by group. Developer-only
 * until it can read and send mail (later steps of the design).
 */
export const mailApp = defineApp({
  id: "mail",
  name: "Mail",
  basePath: "/mail",
  icon: symbol("mail"),
  category: ["Office", "Documents"],
  colorMode: "dark",
  audience: "developer",
});
