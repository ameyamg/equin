import { and, eq, or, sql } from "drizzle-orm";
import { defineRetention } from "@plugins/infra/plugins/retention/server";
import { _mailQueries, _mailQueryMembers, _mailThreads } from "./tables";

// Eviction (design §3): the cache keeps what was read recently, the rest goes
// and is re-fetched on the next read that needs it. Every table here lives in
// the worktree's own database (left out of forks), so each sweeps its own.

/**
 * A query unread for 30 days loses its coverage (its members go with it); a
 * search is a query of its own, kept a day. One sweep (a job per table): the
 * TTL is the search's, the rest wait their 30 days.
 */
export const mailQueriesRetention = defineRetention({
  table: _mailQueries,
  column: "lastReadAt",
  ttlDays: 1,
  cron: "20 4 * * *",
  perWorktree: true,
  where: or(
    eq(_mailQueries.isSearch, true),
    sql`${_mailQueries.lastReadAt} < now() - interval '30 days'`,
  )!,
});

/** A thread no query holds and no window showed for 30 days. */
export const mailThreadsRetention = defineRetention({
  table: _mailThreads,
  column: "lastUsedAt",
  ttlDays: 30,
  cron: "30 4 * * *",
  perWorktree: true,
  where: and(
    sql`not exists (select 1 from ${_mailQueryMembers} m where m.account_id = ${_mailThreads.accountId} and m.thread_id = ${_mailThreads.threadId})`,
  )!,
});
