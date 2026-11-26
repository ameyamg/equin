import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { cacheTableExclusions } from "./internal/declarations";
import {
  listenToPush,
  mailAccountStatusServed,
  mailMailboxesServed,
  mailSync,
  mailThreadsServed,
} from "./internal/served";
import {
  mailQueriesRetention,
  mailThreadsRetention,
} from "./internal/retention";

export {
  _mailAccounts,
  _mailMailboxes,
  _mailQueries,
  _mailQueryMembers,
  _mailThreads,
} from "./internal/tables";

export default {
  description:
    "The Mail cache, server half: the mail_* tables (one account, its mailboxes, cached thread summaries, per-query coverage and members), mail.threads served external — a window answered from coverage, else filled from the provider's date-ordered message list (cut at the coverage floor widened by the provider's declared clock slack, summaries fetched only when not cached, stale or missing the listed message), one sync step per account (coalesced: a read's catch-up, every change the provider's push signals, a 30 s tick while any mail view is subscribed and push is not live — the documented no-polling exception — and a 10-min job on main) applying the provider's changes since the cursor, re-checking locally maintained queries per message and re-listing the others, notifying open windows and relisting the mailbox counts, a reset marking everything stale — mail.account-status (connection, change signal — push state and whether the fallback ticks — last sync and its failure), refused typed when not connected / offline and not cached / a filter rule the provider cannot run — mail.mailboxes with the provider's counts, and the eviction sweeps.",
  contributions: [
    ...mailThreadsServed.declare,
    ...mailMailboxesServed.declare,
    ...mailAccountStatusServed.declare,
    ...cacheTableExclusions,
  ],
  register: [
    mailQueriesRetention,
    mailThreadsRetention,
    mailSync.tick,
    mailSync.idleJob,
  ],
  onReady: () => {
    listenToPush();
  },
} satisfies ServerPluginDefinition;
