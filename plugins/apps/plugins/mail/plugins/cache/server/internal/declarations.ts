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

// The cache tables' growth bounds (checked at module eval) and their
// exclusion from the change feed. (A cache is left out of forks and backups
// too: those are the computer's, declared in machine/.)

markCascadeBounded(_mailMailboxes, _mailAccounts);
markCascadeBounded(_mailQueryMembers, _mailQueries);
// Also held under the byte budget, evicted least recently opened first (engine).
markCascadeBounded(_mailThreadBodies, _mailThreads);

export const CACHE_TABLES = [
  _mailAccounts,
  _mailMailboxes,
  _mailThreads,
  _mailQueries,
  _mailQueryMembers,
  _mailThreadBodies,
];

export const cacheTableExclusions = CACHE_TABLES.map((table) =>
  ExcludeFromChangeFeed({
    table,
    reason:
      "Mail cache: only the cache writes it, and it notifies mail.threads / mail.mailboxes itself (external arm).",
  }),
);
