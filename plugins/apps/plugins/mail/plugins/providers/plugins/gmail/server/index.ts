import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { MailProviders } from "@plugins/apps/plugins/mail/plugins/provider/server";
import { disableGmailPush, enableGmailPush } from "../core";
import { gmailMailProvider } from "./internal/definition";
import { pushTableExclusions } from "./internal/push/declarations";
import {
  gmailPushServed,
  gmailWatchRenewal,
  handleDisable,
  handleEnable,
  startPushOnBoot,
  stopPushOnShutdown,
} from "./internal/push/push";

export { _mailGmailPush } from "./internal/tables";

export default {
  description:
    "Registers the Gmail mail provider: MailProvider over integrations/gmail/api, one client and quota pacer per account, Gmail's q compiled from the contract's filter — and its push: Gmail publishing mailbox changes to a Pub/Sub topic in the user's own Google Cloud project (POST /api/mail/gmail/push/enable: topic, Gmail's publisher grant, this backend's pull subscription, users.watch; /disable), held pulls on this backend's subscription signalling the cache's sync step, the daily mail.gmail-watch-renew job on main, and mail.gmail-push (setup and consumer state).",
  contributions: [
    MailProviders.Provider(gmailMailProvider),
    ...gmailPushServed.declare,
    ...pushTableExclusions,
  ],
  httpRoutes: {
    [enableGmailPush.route]: handleEnable,
    [disableGmailPush.route]: handleDisable,
  },
  register: [gmailWatchRenewal],
  onReady: startPushOnBoot,
  onShutdown: stopPushOnShutdown,
} satisfies ServerPluginDefinition;
