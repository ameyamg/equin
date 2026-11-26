import {
  ExcludeFromBackup,
  ExcludeFromFork,
} from "@plugins/database/plugins/admin/server";
import { ExcludeFromChangeFeed } from "@plugins/network/plugins/live/plugins/change-feed/server";
import { markCascadeBounded } from "@plugins/infra/plugins/retention/server";
import {
  _mailAccounts,
  _mailMailboxes,
  _mailQueries,
  _mailQueryMembers,
  _mailThreadBodies,
  _mailThreads,
} from "./tables";

// The cache tables' growth bounds (checked at module eval) and exclusions: a
// cache is left out of forks, backups and the change feed.

markCascadeBounded(_mailMailboxes, _mailAccounts);
markCascadeBounded(_mailQueryMembers, _mailQueries);
// Also held under the byte budget, evicted least recently opened first (engine).
markCascadeBounded(_mailThreadBodies, _mailThreads);

const CACHE_TABLES = [
  _mailAccounts,
  _mailMailboxes,
  _mailThreads,
  _mailQueries,
  _mailQueryMembers,
  _mailThreadBodies,
];

export const cacheTableExclusions = CACHE_TABLES.flatMap((table) => [
  ExcludeFromFork({
    table,
    reason:
      "Mail cache: a worktree reads its own from the provider on demand (a copy would share main's change cursor).",
  }),
  ExcludeFromBackup({
    table,
    reason: "Mail cache: re-read from the mail provider on demand.",
  }),
  ExcludeFromChangeFeed({
    table,
    reason:
      "Mail cache: only the cache writes it, and it notifies mail.threads / mail.mailboxes itself (external arm).",
  }),
]);
