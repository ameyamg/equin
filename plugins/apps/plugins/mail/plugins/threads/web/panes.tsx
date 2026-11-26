import { Pane, defineRoute } from "@plugins/primitives/plugins/pane/web";
import { mailApp } from "@plugins/apps/plugins/mail/plugins/shell/core";
import { MailScreen } from "./components/mail-screen";

/**
 * Mail's index pane — what bare `/mail` shows: the threads list with the mail
 * sidebar beside it, full-surface (no pane header: the sidebar names the
 * active view). The active view is in the URL (`;view.mail.threads=<id>`).
 */
export const mailThreadsPane = Pane.define({
  title: mailApp.name,
  route: defineRoute({ id: "mail-threads", segment: "" }),
  app: mailApp,
  appIndex: true,
  component: MailScreen,
});
