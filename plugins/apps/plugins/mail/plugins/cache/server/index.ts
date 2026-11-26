import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { cacheTableExclusions } from "./internal/declarations";
import { mailMailboxesServed, mailThreadsServed } from "./internal/served";
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
    "The Mail cache, server half: the mail_* tables (one account, its mailboxes, cached thread summaries, per-query coverage and members), mail.threads served external — a window answered from coverage, else filled from the provider's date-ordered message list (cut at the coverage floor widened by the provider's declared clock slack, summaries fetched only when not cached, stale or missing the listed message), a background catch-up from the change cursor that re-checks locally maintained queries per message and re-lists the others, refused typed when not connected / offline and not cached / a filter rule the provider cannot run — mail.mailboxes with the provider's counts, and the eviction sweeps.",
  contributions: [
    ...mailThreadsServed.declare,
    ...mailMailboxesServed.declare,
    ...cacheTableExclusions,
  ],
  register: [mailQueriesRetention, mailThreadsRetention],
} satisfies ServerPluginDefinition;
