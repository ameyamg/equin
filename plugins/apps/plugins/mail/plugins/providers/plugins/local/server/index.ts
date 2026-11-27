import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { MailProviders } from "@plugins/apps/plugins/mail/plugins/provider/server";
import { localMail } from "./internal/served";

export {
  _mailLocalAccounts,
  _mailLocalAttachments,
  _mailLocalChanges,
  _mailLocalMailboxes,
  _mailLocalMessages,
} from "./internal/tables";
export {
  LOCAL_ACCOUNT_ID,
  LOCAL_MAILBOX_COLORS,
  type LocalDelivery,
} from "./internal/provider";
export { localMail } from "./internal/served";

export default {
  description:
    "The local mail provider (id `local`, \"This device\"): a MailProvider whose mailbox lives in this host's own database (mail_local_* tables, every time a timestamptz) — no network, no computer, so it runs on every host (the website's demo serves it from PGlite). Its query is the contract's canonical filter, compiled to SQL by the filter language's SQL half; lists page by (date, id); summaries and counts derived in SQL; every write one atomic statement appending to the change log (its seq the cursor, a thread's latest seq its version); push in-process and always live; send parses the bytes back and stores the message in Sent, threaded by In-Reply-To / References (never delivered anywhere; to the account's own address, also its Inbox). localMail.deliver is the inbound write (mail arriving — no user endpoint makes one) and localMail.setAccount sets up the one account; both are what a fixture writer calls.",
  contributions: [MailProviders.Provider(localMail.definition)],
} satisfies ServerPluginDefinition;
