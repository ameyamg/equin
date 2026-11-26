import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { writeAtomically, type Db } from "@plugins/database/server";
import { wallNow } from "@plugins/packages/plugins/deadline/core";
import {
  canonicalizeFilter,
  decodeFilter,
  encodeFilter,
  matchesFilter,
  type Filter,
} from "@plugins/network/plugins/live/plugins/filter/core";
import type { LiveCutKey } from "@plugins/network/plugins/live/core";
import { ResourceRefusal } from "@plugins/network/plugins/live/plugins/resource-protocol/core";
import { createKeyedMutex } from "@plugins/packages/plugins/keyed-mutex/core";
import { createKeyedCoalescer } from "@plugins/packages/plugins/coalesce/core";
import {
  changeCursor,
  MAIL_QUERY_COLUMNS,
  MailNotConnectedError,
  MailUnreachableError,
  providerQuery,
  type ChangeCursor,
  type Mailbox,
  type MailboxId,
  type MailCallOptions,
  type MailProvider,
  type MailProviderDefinition,
  type MailQuery,
  type ThreadId,
  type ThreadSummary,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import type {
  MailMailboxRow,
  MailThreadRow,
  MailThreadsRefusal,
} from "../../core";
import {
  _mailAccounts,
  _mailMailboxes,
  _mailQueries,
  _mailQueryMembers,
  _mailThreads,
} from "./tables";
import { loadSummary, storeSummary } from "./stored-summary";
import type { MailAccountStatus } from "../../core";

// The Mail cache's engine (design §3–4). It answers any DataView window of
// `mail.threads` from per-query COVERAGE, filling it from the provider on
// demand — never a mirror of the mailbox:
//
// - A query is one compiled filter. Its members are the threads with a
//   matching message, each at its LATEST matching message (`at`), the order a
//   date-sorted thread list pages in. Coverage says how far down the order
//   the members are complete: every thread with a matching message dated
//   after `floorAt` (all of them once `exhausted`).
// - A window inside coverage is answered from Postgres alone. One past it is
//   FILLED: the provider's message list (newest first, by its own clock) is
//   read from the coverage's cut down, each hit placed by its message's date
//   from the thread's summary — fetched only when not cached, stale, or
//   missing that message (a new one) — and the floor moved to the last
//   placed message plus the provider's declared `listOrderSlackMs`, so a
//   message the provider lists slightly out of date order is never missed.
// - Freshness: summaries are current at the account's change cursor. After a
//   read, a background catch-up reads the provider's changes since it,
//   re-reads the changed threads and re-checks every locally maintained
//   query per message (§4); a provider-evaluated query a change may have
//   moved is unverified, and its next read answers from the cache and
//   re-lists it in the background, notifying when anything moved.
// - Not answerable is typed (`refuse`): not connected, offline with the
//   window not covered, a filter rule the provider cannot run. Never an
//   empty list.

/** The query columns the cache holds exactly per message (`MessageFacts`): a query over them alone is kept by the cache itself. */
const LOCAL_COLUMNS: ReadonlySet<string> = new Set([
  "mailboxes",
  "unread",
  "starred",
]);
/** Messages asked of the provider per list call (Gmail: 5 units whatever the size). */
const LIST_PAGE = 100;
/** At most this many threads' summaries are resolved per step of a fill. */
const SUMMARY_BATCH_MAX = 50;
/** Threads a fill step reads past the rows it lacks: the slack's margin. */
const SLACK_EXTRA_THREADS = 2;
/** Past this many changed threads in one catch-up, cached ones are marked stale (re-read when listed) instead of re-read now. */
const CATCH_UP_REFETCH_MAX = 200;
/** Past this many changed threads not cached, the queries are re-listed instead (unverified). */
const CATCH_UP_NEW_MAX = 50;
/** A thread's `last_used_at` is written at most this often. */
const USED_TOUCH_MS = 60 * 60 * 1000;

export type MailCacheDeps = {
  db: Db;
  /** The provider kind the account is on (v1: the one registered). */
  definition: () => MailProviderDefinition;
  refuse: (code: MailThreadsRefusal, message: string) => Error;
  /** Every subscribed `mail.threads` window re-reads (`ids`: the threads that changed, for the by-id tuples). */
  notifyThreads: (ids?: readonly string[]) => void;
  /** Every subscribed `mail.mailboxes` tuple re-reads. */
  notifyMailboxes: () => void;
  /** `mail.account-status` re-reads (a sync step ended, the tick started or stopped). */
  notifyStatus: () => void;
  /** How changes reach the cache now (the fallback tick, and whether it runs). */
  changeSignal: () => Extract<
    MailAccountStatus,
    { kind: "account" }
  >["changeSignal"];
  /** A background run's failure that is not "offline": surfaced, never dropped. */
  onBackgroundError: (what: string, err: unknown) => void;
};

/** A decoded `mail.threads` window (the live API's LiveDecodedQuery, the fields the cache reads). */
export type MailWindowQuery = {
  limit: number;
  where: Filter | undefined;
  after?: LiveCutKey;
  until?: LiveCutKey;
};

type Account = {
  id: string;
  definition: MailProviderDefinition;
  provider: MailProvider;
  cursor: ChangeCursor;
};

type QueryRow = typeof _mailQueries.$inferSelect;

/** A cut key `[at ISO text, thread id]`, decoded. */
function cutOf(key: LiveCutKey): { at: Date; id: string } {
  const [at, id] = key;
  if (at === null || at === undefined || id === null || id === undefined) {
    throw new Error(
      `mail.threads: a cut has no date or id: ${JSON.stringify(key)}`,
    );
  }
  return { at: new Date(at), id };
}

const collateC = (col: unknown) => sql`${col} collate "C"`;

/** Every clause of a canonical filter. */
function clausesOf(f: Filter): { column: string; op: string }[] {
  if ("and" in f) return f.and.flatMap(clausesOf);
  if ("or" in f) return f.or.flatMap(clausesOf);
  return [f as { column: string; op: string }];
}

/** The per-message row a locally maintained query is re-checked on. */
function messageRow(m: ThreadSummary["messages"][number]) {
  return { mailboxes: m.mailboxes, unread: m.unread, starred: m.starred };
}

/**
 * Where a thread sits in a locally maintained query: its latest message
 * matching the WHOLE filter (the query is per message), or null when none
 * does. Never evaluated over the thread's unions.
 */
export function localMatchAt(
  s: ThreadSummary,
  filter: Filter | undefined,
): Date | null {
  let at: number | null = null;
  for (const m of s.messages) {
    if (
      filter === undefined ||
      matchesFilter(messageRow(m) as never, filter as never, MAIL_QUERY_COLUMNS)
    ) {
      at = Math.max(at ?? -Infinity, m.date.getTime());
    }
  }
  return at === null ? null : new Date(at);
}

function rowOf(s: ThreadSummary, date: Date): MailThreadRow {
  return {
    id: s.id,
    subject: s.subject,
    from: s.participants.map((p) => p.name ?? p.address).join(", "),
    to: s.recipients.map((p) => p.name ?? p.address).join(", "),
    date,
    mailboxes: [...s.mailboxes],
    unread: s.unread,
    starred: s.starred,
    hasAttachment: s.hasAttachments,
    query: null,
    snippet: s.snippet,
    participants: s.participants,
    recipients: s.recipients,
    lastMessageAt: s.lastMessageAt,
    messageCount: s.messageCount,
    hasDraft: s.hasDraft,
  } as MailThreadRow;
}

function mailboxOfRow(r: typeof _mailMailboxes.$inferSelect): Mailbox {
  return {
    id: r.mailboxId as MailboxId,
    name: r.name,
    role: r.role as Mailbox["role"],
    kind: r.kind as Mailbox["kind"],
    parentId: r.parentId as MailboxId | null,
    counts:
      r.threadsTotal === null || r.threadsUnread === null
        ? null
        : { threads: r.threadsTotal, unread: r.threadsUnread },
    color: r.color,
  };
}

export function createMailCache(deps: MailCacheDeps) {
  const { db } = deps;
  const queryMutex = createKeyedMutex("mail-cache-query");
  const accountMutex = createKeyedMutex("mail-cache-account");
  const fg: MailCallOptions = { priority: "foreground" };
  const bg: MailCallOptions = { priority: "background" };

  /** The provider's failures as the window's typed refusals; anything else as is. */
  function refused(err: unknown, what: string): Error {
    if (err instanceof MailNotConnectedError) {
      return deps.refuse("not-connected", err.message);
    }
    if (err instanceof MailUnreachableError) {
      return deps.refuse(
        "offline-not-cached",
        `Offline: ${what} is not cached (${err.message})`,
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  /** Runs `fn`, turning the provider's typed failures into refusals. */
  async function orRefuse<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw refused(err, what);
    }
  }

  // ── the account ─────────────────────────────────────────────────────────

  /** The connected account, its row made (a different address than the row's: the cache is someone else's, deleted). */
  async function account(): Promise<Account> {
    const definition = deps.definition();
    const c = await definition.connectedAccount();
    if (c.kind === "not-connected") {
      throw deps.refuse("not-connected", c.message);
    }
    if (c.kind === "unreachable") return offlineAccount(definition, c.message);
    return accountMutex.run(c.accountId, async () => {
      let [row] = await db
        .select()
        .from(_mailAccounts)
        .where(eq(_mailAccounts.id, c.accountId));
      if (
        row &&
        (row.address !== c.address || row.providerId !== definition.id)
      ) {
        await db.delete(_mailAccounts).where(eq(_mailAccounts.id, c.accountId));
        row = undefined;
      }
      if (!row) {
        [row] = await db
          .insert(_mailAccounts)
          .values({
            id: c.accountId,
            providerId: definition.id,
            address: c.address,
            cursor: null,
          })
          .returning();
      }
      const provider = definition.open(c.accountId);
      let cursor = row!.cursor;
      if (cursor === null) {
        // Read BEFORE any summary is: every change after it is replayed.
        cursor = await orRefuse("the account", () =>
          provider.currentCursor(fg),
        );
        await db
          .update(_mailAccounts)
          .set({ cursor })
          .where(eq(_mailAccounts.id, c.accountId));
      }
      return {
        id: c.accountId,
        definition,
        provider,
        cursor: changeCursor(cursor),
      };
    });
  }

  /**
   * The connection cannot be checked now (offline): the account the cache
   * holds for this provider, so covered windows still answer — its provider
   * calls fail typed, so an uncovered one is refused `offline-not-cached`.
   * None held (or a cursor never read): nothing to answer from.
   */
  async function offlineAccount(
    definition: MailProviderDefinition,
    message: string,
  ): Promise<Account> {
    const rows = await db
      .select()
      .from(_mailAccounts)
      .where(eq(_mailAccounts.providerId, definition.id));
    const [row] = rows;
    if (rows.length !== 1 || row!.cursor === null) {
      throw deps.refuse(
        "offline-not-cached",
        `Offline: the mail account cannot be checked and nothing is cached (${message})`,
      );
    }
    return {
      id: row!.id,
      definition,
      provider: definition.open(row!.id),
      cursor: changeCursor(row!.cursor),
    };
  }

  // ── mailboxes ───────────────────────────────────────────────────────────

  async function cachedMailboxes(accountId: string): Promise<Mailbox[]> {
    const rows = await db
      .select()
      .from(_mailMailboxes)
      .where(eq(_mailMailboxes.accountId, accountId))
      .orderBy(asc(_mailMailboxes.name));
    return rows.map(mailboxOfRow);
  }

  async function relistMailboxes(a: Account, o: MailCallOptions) {
    const listed = await a.provider.listMailboxes(o);
    await writeAtomically(db, [
      listed.length === 0
        ? null
        : db
            .insert(_mailMailboxes)
            .values(
              listed.map((m) => ({
                accountId: a.id,
                mailboxId: m.id,
                name: m.name,
                role: m.role,
                kind: m.kind,
                parentId: m.parentId,
                threadsTotal: m.counts?.threads ?? null,
                threadsUnread: m.counts?.unread ?? null,
                color: m.color,
              })),
            )
            .onConflictDoUpdate({
              target: [_mailMailboxes.accountId, _mailMailboxes.mailboxId],
              set: {
                name: sql`excluded.name`,
                role: sql`excluded.role`,
                kind: sql`excluded.kind`,
                parentId: sql`excluded.parent_id`,
                threadsTotal: sql`excluded.threads_total`,
                threadsUnread: sql`excluded.threads_unread`,
                color: sql`excluded.color`,
              },
            }),
      db.delete(_mailMailboxes).where(
        listed.length === 0
          ? eq(_mailMailboxes.accountId, a.id)
          : and(
              eq(_mailMailboxes.accountId, a.id),
              notInArray(
                _mailMailboxes.mailboxId,
                listed.map((m) => m.id),
              ),
            ),
      ),
    ]);
    deps.notifyMailboxes();
    return listed;
  }

  /** The account's mailboxes: cached, else listed now. */
  async function mailboxesOf(a: Account): Promise<Mailbox[]> {
    const cached = await cachedMailboxes(a.id);
    if (cached.length > 0) return cached;
    return orRefuse("the mailboxes", () => relistMailboxes(a, fg));
  }

  // ── queries ─────────────────────────────────────────────────────────────

  /** The query row of a compiled filter, made on first use; `last_read_at` stamped. */
  async function queryRow(
    a: Account,
    pq: string,
    canonical: Filter | undefined,
  ): Promise<QueryRow> {
    const clauses = canonical === undefined ? [] : clausesOf(canonical);
    const [row] = await db
      .insert(_mailQueries)
      .values({
        accountId: a.id,
        providerQuery: pq,
        filter:
          canonical === undefined
            ? null
            : (encodeFilter(canonical, MAIL_QUERY_COLUMNS) ?? null),
        locallyMaintained: clauses.every((c) => LOCAL_COLUMNS.has(c.column)),
        isSearch: clauses.some((c) => c.column === "query"),
        lastReadAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [_mailQueries.accountId, _mailQueries.providerQuery],
        set: { lastReadAt: new Date() },
      })
      .returning();
    return row!;
  }

  async function queryById(queryId: number): Promise<QueryRow> {
    const [row] = await db
      .select()
      .from(_mailQueries)
      .where(eq(_mailQueries.queryId, queryId));
    if (!row) throw new Error(`mail cache: query ${queryId} is gone`);
    return row;
  }

  /** The predicate of a window's range `(after, until]` over members, above coverage's floor. */
  function rangeWhere(qr: QueryRow, w: MailWindowQuery) {
    const m = _mailQueryMembers;
    const parts = [eq(m.queryId, qr.queryId)];
    if (!qr.exhausted) {
      if (qr.floorAt === null) parts.push(sql`false`);
      else parts.push(gt(m.at, qr.floorAt));
    }
    if (w.after) {
      const c = cutOf(w.after);
      parts.push(
        or(
          lt(m.at, c.at),
          and(eq(m.at, c.at), sql`${collateC(m.threadId)} > ${c.id}`),
        )!,
      );
    }
    if (w.until) {
      const c = cutOf(w.until);
      parts.push(
        or(
          gt(m.at, c.at),
          and(eq(m.at, c.at), sql`${collateC(m.threadId)} <= ${c.id}`),
        )!,
      );
    }
    return and(...parts)!;
  }

  /**
   * How many rows the window still lacks above coverage's floor: 0 when
   * coverage answers it whole (`limit` rows above the floor, the range ends
   * above it, or the list is exhausted).
   */
  async function missing(qr: QueryRow, w: MailWindowQuery): Promise<number> {
    if (qr.exhausted) return 0;
    if (qr.floorAt === null) return w.limit;
    if (w.until && cutOf(w.until).at.getTime() > qr.floorAt.getTime()) return 0;
    const [r] = await db.select({ n: sql`count(*)::int`.mapWith(Number) }).from(
      db
        .select({ one: sql`1` })
        .from(_mailQueryMembers)
        .where(rangeWhere(qr, w))
        .limit(w.limit)
        .as("w"),
    );
    return Math.max(0, w.limit - r!.n);
  }

  async function answer(
    a: Account,
    qr: QueryRow,
    w: MailWindowQuery,
  ): Promise<MailThreadRow[]> {
    const m = _mailQueryMembers;
    const t = _mailThreads;
    const rows = await db
      .select({
        at: m.at,
        summary: t.summary,
        lastUsedAt: t.lastUsedAt,
        threadId: t.threadId,
      })
      .from(m)
      .innerJoin(
        t,
        and(eq(t.accountId, m.accountId), eq(t.threadId, m.threadId)),
      )
      .where(rangeWhere(qr, w))
      .orderBy(desc(m.at), collateC(m.threadId))
      .limit(w.limit);
    const now = wallNow("retention");
    const touch = rows
      .filter((r) => now - r.lastUsedAt.getTime() > USED_TOUCH_MS)
      .map((r) => r.threadId);
    if (touch.length > 0) {
      await db
        .update(t)
        .set({ lastUsedAt: new Date(now) })
        .where(and(eq(t.accountId, a.id), inArray(t.threadId, touch)));
    }
    return rows.map((r) => rowOf(loadSummary(r.summary), r.at));
  }

  // ── summaries ───────────────────────────────────────────────────────────

  async function upsertSummaries(accountId: string, found: ThreadSummary[]) {
    if (found.length === 0) return;
    const now = new Date();
    await db
      .insert(_mailThreads)
      .values(
        found.map((s) => ({
          accountId,
          threadId: s.id,
          version: s.version,
          summary: storeSummary(s),
          lastMessageAt: s.lastMessageAt,
          stale: false,
          fetchedAt: now,
          lastUsedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [_mailThreads.accountId, _mailThreads.threadId],
        set: {
          version: sql`excluded.version`,
          summary: sql`excluded.summary`,
          lastMessageAt: sql`excluded.last_message_at`,
          stale: false,
          fetchedAt: now,
        },
      });
  }

  async function deleteThreads(accountId: string, ids: readonly string[]) {
    if (ids.length === 0) return;
    await db
      .delete(_mailThreads)
      .where(
        and(
          eq(_mailThreads.accountId, accountId),
          inArray(_mailThreads.threadId, [...ids]),
        ),
      );
  }

  /** Re-reads `ids` from the provider: found upserted, gone deleted; a per-thread failure thrown. */
  async function fetchSummaries(
    a: Account,
    ids: readonly ThreadId[],
    o: MailCallOptions,
  ): Promise<Map<string, ThreadSummary>> {
    const out = new Map<string, ThreadSummary>();
    if (ids.length === 0) return out;
    const results = await a.provider.getThreads(ids, o);
    const gone: string[] = [];
    for (const r of results) {
      if (r.kind === "found") out.set(r.id, r.summary);
      else if (r.kind === "gone") gone.push(r.id);
      else throw r.error;
    }
    await upsertSummaries(a.id, [...out.values()]);
    await deleteThreads(a.id, gone);
    return out;
  }

  /**
   * The summaries of `threads`, current enough to place `messages` (each
   * hit's message): cached and not stale and holding the message, else
   * re-read. A thread gone at the provider is absent from the answer.
   */
  async function summariesFor(
    a: Account,
    hits: readonly { thread: ThreadId; message: string }[],
    o: MailCallOptions,
  ): Promise<Map<string, ThreadSummary>> {
    const ids = [...new Set(hits.map((h) => h.thread))];
    const cached = new Map<string, ThreadSummary>();
    const rows = await db
      .select({
        threadId: _mailThreads.threadId,
        summary: _mailThreads.summary,
        stale: _mailThreads.stale,
      })
      .from(_mailThreads)
      .where(
        and(
          eq(_mailThreads.accountId, a.id),
          inArray(_mailThreads.threadId, ids),
        ),
      );
    for (const r of rows)
      if (!r.stale) cached.set(r.threadId, loadSummary(r.summary));
    const need = new Set<ThreadId>();
    for (const h of hits) {
      const s = cached.get(h.thread);
      if (!s || !s.messages.some((m) => m.id === h.message)) need.add(h.thread);
    }
    const fetched = await fetchSummaries(a, [...need], o);
    for (const id of need) {
      const s = fetched.get(id);
      if (s) cached.set(id, s);
      else cached.delete(id);
    }
    return cached;
  }

  // ── fill ────────────────────────────────────────────────────────────────

  /**
   * Extends a query's coverage down the provider's message list until the
   * window `missing()` nothing or the list ends. Each processed hit is committed with
   * the floor it allows, so a fill cut short (offline mid-way) keeps what it
   * placed and a later one resumes at its cut.
   */
  async function fill(
    a: Account,
    queryId: number,
    missingOf: (qr: QueryRow) => Promise<number>,
    o: MailCallOptions,
  ): Promise<QueryRow> {
    const slack = a.definition.capabilities.listOrderSlackMs;
    let qr = await queryById(queryId);
    const pq = providerQuery(qr.providerQuery);
    const olderThan =
      qr.floorAt === null ? null : new Date(qr.floorAt.getTime() + slack);
    let cursor: Parameters<MailProvider["listMessages"]>[1]["cursor"] = null;
    let pending: { thread: ThreadId; message: string }[] = [];
    let listEnded = false;
    for (let lack = await missingOf(qr); lack > 0; lack = await missingOf(qr)) {
      if (pending.length === 0) {
        if (listEnded) {
          await db
            .update(_mailQueries)
            .set({ exhausted: true })
            .where(eq(_mailQueries.queryId, queryId));
          return queryById(queryId);
        }
        const page = await a.provider.listMessages(
          pq,
          { olderThan, limit: LIST_PAGE, cursor },
          o,
        );
        pending = page.hits;
        cursor = page.next;
        listEnded = page.next === null;
        continue;
      }
      // Resolve the next threads' summaries — as many as the window still
      // lacks, plus a few for the slack (the last placed row is claimed only
      // once a message past it is placed), so a fill fetches what it places.
      const batch: typeof pending = [];
      const threads = new Set<string>();
      const take = Math.min(SUMMARY_BATCH_MAX, lack + SLACK_EXTRA_THREADS);
      for (const h of pending) {
        if (!threads.has(h.thread) && threads.size >= take) break;
        threads.add(h.thread);
        batch.push(h);
      }
      pending = pending.slice(batch.length);
      const summaries = await summariesFor(a, batch, o);
      let floor = qr.floorAt?.getTime() ?? Infinity;
      const placed = new Map<string, number>();
      for (const h of batch) {
        const s = summaries.get(h.thread);
        // Gone since it was listed, or the message left it (deleted): not a member.
        const m = s?.messages.find((x) => x.id === h.message);
        if (!m) continue;
        const at = m.date.getTime();
        placed.set(h.thread, Math.max(placed.get(h.thread) ?? -Infinity, at));
        floor = Math.min(floor, at + slack);
      }
      await writeAtomically(db, [
        placed.size === 0
          ? null
          : db
              .insert(_mailQueryMembers)
              .values(
                [...placed].map(([threadId, at]) => ({
                  queryId,
                  accountId: a.id,
                  threadId,
                  at: new Date(at),
                })),
              )
              .onConflictDoUpdate({
                target: [_mailQueryMembers.queryId, _mailQueryMembers.threadId],
                set: {
                  at: sql`greatest(${_mailQueryMembers.at}, excluded.at)`,
                },
              }),
        floor === Infinity
          ? null
          : db
              .update(_mailQueries)
              .set({ floorAt: new Date(floor) })
              .where(eq(_mailQueries.queryId, queryId)),
      ]);
      qr = await queryById(queryId);
    }
    return qr;
  }

  /**
   * Re-lists a query from the head down to its floor and replaces the members
   * above it with what the provider answers now (stale-while-revalidate for a
   * query a change may have moved). Notifies when anything moved.
   */
  async function relist(a: Account, queryId: number) {
    await queryMutex.run(String(queryId), async () => {
      const [before] = await db
        .select()
        .from(_mailQueries)
        .where(eq(_mailQueries.queryId, queryId));
      // Evicted, or its account's cache dropped, since the read that asked.
      if (!before || before.verifiedCursor === a.cursor) return;
      const slack = a.definition.capabilities.listOrderSlackMs;
      const pq = providerQuery(before.providerQuery);
      const oldFloor = before.exhausted
        ? -Infinity
        : (before.floorAt?.getTime() ?? Infinity);
      const found = new Map<string, number>();
      let floor = Infinity;
      let cursor: Parameters<MailProvider["listMessages"]>[1]["cursor"] = null;
      let exhausted = false;
      while (floor > oldFloor) {
        const page = await a.provider.listMessages(
          pq,
          { olderThan: null, limit: LIST_PAGE, cursor },
          bg,
        );
        let i = 0;
        for (; i < page.hits.length && floor > oldFloor; i += 25) {
          const batch = page.hits.slice(i, i + 25);
          const summaries = await summariesFor(a, batch, bg);
          for (const h of batch) {
            const m = summaries
              .get(h.thread)
              ?.messages.find((x) => x.id === h.message);
            if (!m) continue;
            const at = m.date.getTime();
            found.set(h.thread, Math.max(found.get(h.thread) ?? -Infinity, at));
            floor = Math.min(floor, at + slack);
          }
        }
        // The list ended AND every hit of its last page was placed: only then
        // is everything below known. Stopped early, the old floor stands.
        if (page.next === null) {
          exhausted = i >= page.hits.length;
          break;
        }
        cursor = page.next;
      }
      const keepFloor = exhausted ? null : Math.max(floor, oldFloor);
      const current = await db
        .select({
          threadId: _mailQueryMembers.threadId,
          at: _mailQueryMembers.at,
        })
        .from(_mailQueryMembers)
        .where(eq(_mailQueryMembers.queryId, queryId));
      const above = (at: number) => keepFloor === null || at > keepFloor;
      const was = new Map(
        current
          .filter((r) => above(r.at.getTime()))
          .map((r) => [r.threadId, r.at.getTime()]),
      );
      const now = new Map([...found].filter(([, at]) => above(at)));
      const moved =
        was.size !== now.size ||
        [...now].some(([id, at]) => was.get(id) !== at);
      const gone = [...was.keys()].filter((id) => !now.has(id));
      await writeAtomically(db, [
        gone.length === 0
          ? null
          : db
              .delete(_mailQueryMembers)
              .where(
                and(
                  eq(_mailQueryMembers.queryId, queryId),
                  inArray(_mailQueryMembers.threadId, gone),
                ),
              ),
        now.size === 0
          ? null
          : db
              .insert(_mailQueryMembers)
              .values(
                [...now].map(([threadId, at]) => ({
                  queryId,
                  accountId: a.id,
                  threadId,
                  at: new Date(at),
                })),
              )
              .onConflictDoUpdate({
                target: [_mailQueryMembers.queryId, _mailQueryMembers.threadId],
                set: { at: sql`excluded.at` },
              }),
        db
          .update(_mailQueries)
          .set({
            verifiedCursor: a.cursor,
            ...(exhausted ? { exhausted: true } : {}),
          })
          .where(eq(_mailQueries.queryId, queryId)),
      ]);
      if (moved) deps.notifyThreads();
    });
  }

  // ── catch-up: the account's changes since its cursor ───────────────────

  /**
   * The account's changes since its cursor, applied. Answers whether it ran
   * for `accountId` (false: the connected account is another one now).
   * Each page's cursor is saved only once all its effects are written — the
   * mailbox relist included — so a step failing mid-way re-reads that page;
   * the threads already moved are notified whatever happens after.
   */
  async function catchUp(accountId: string): Promise<boolean> {
    const a = await account();
    if (a.id !== accountId) return false;
    let cursor = a.cursor;
    const moved = new Set<string>();
    try {
      for (;;) {
        const changes = await a.provider.changesSince(cursor, bg);
        if (changes.kind === "reset") {
          const next = await a.provider.currentCursor(bg);
          await writeAtomically(db, [
            db
              .update(_mailThreads)
              .set({ stale: true })
              .where(eq(_mailThreads.accountId, a.id)),
            db
              .update(_mailQueries)
              .set({ verifiedCursor: null })
              .where(eq(_mailQueries.accountId, a.id)),
            db
              .update(_mailAccounts)
              .set({ cursor: next })
              .where(eq(_mailAccounts.id, a.id)),
          ]);
          moved.clear();
          deps.notifyThreads();
          // Counts may have moved in the history lost: relisted now.
          await relistMailboxes(a, bg);
          return true;
        }
        const ids = changes.threads;
        if (ids.length > 0) {
          await applyThreadChanges({ ...a, cursor: changes.next }, ids, cursor);
          for (const id of ids) moved.add(id);
        } else {
          // Nothing moved: every query verified at the old cursor stays so.
          await db
            .update(_mailQueries)
            .set({ verifiedCursor: changes.next })
            .where(
              and(
                eq(_mailQueries.accountId, a.id),
                eq(_mailQueries.verifiedCursor, cursor),
              ),
            );
        }
        // Counts move with mail on every provider, and only a relist reads
        // them (and, `mailboxDefinitions: "relist"`, the definitions) — per
        // page, before its cursor (a page is up to 5,000 records: rare).
        if (changes.mailboxes === "changed") await relistMailboxes(a, bg);
        await db
          .update(_mailAccounts)
          .set({ cursor: changes.next })
          .where(eq(_mailAccounts.id, a.id));
        cursor = changes.next;
        if (!changes.more) break;
      }
    } finally {
      if (moved.size > 0) deps.notifyThreads([...moved]);
    }
    return true;
  }

  /**
   * Re-reads the changed threads (the changes from `from` to `a.cursor`) and
   * re-checks every locally maintained query on them, per message.
   */
  async function applyThreadChanges(
    a: Account,
    ids: readonly ThreadId[],
    from: ChangeCursor,
  ) {
    const cachedRows = await db
      .select({ threadId: _mailThreads.threadId })
      .from(_mailThreads)
      .where(
        and(
          eq(_mailThreads.accountId, a.id),
          inArray(_mailThreads.threadId, [...ids]),
        ),
      );
    const cached = new Set(cachedRows.map((r) => r.threadId));
    const fresh = ids.filter((id) => !cached.has(id));
    const queries = await db
      .select()
      .from(_mailQueries)
      .where(eq(_mailQueries.accountId, a.id));
    const local = queries.filter(
      (q) => q.locallyMaintained && q.verifiedCursor !== null,
    );
    let toRead: ThreadId[] = ids.filter((id) => cached.has(id));
    let unverifyLocal = false;
    if (toRead.length > CATCH_UP_REFETCH_MAX) {
      // Too many to re-read now: re-read each when it is next listed.
      await db
        .update(_mailThreads)
        .set({ stale: true })
        .where(
          and(
            eq(_mailThreads.accountId, a.id),
            inArray(_mailThreads.threadId, toRead),
          ),
        );
      toRead = [];
      unverifyLocal = true;
    }
    if (fresh.length > 0 && local.length > 0) {
      if (fresh.length > CATCH_UP_NEW_MAX) unverifyLocal = true;
      else toRead = [...toRead, ...fresh];
    }
    // A thread gone at the provider is deleted here, its memberships with it.
    const summaries = await fetchSummaries(a, toRead, bg);
    // Each query re-checked under its own lock (a fill or re-list of it may
    // be moving its floor), its row read again inside. Only a query verified
    // exactly at `from` stays verified, at `a.cursor`: one that missed an
    // earlier step, or past the re-read bounds, is unverified (re-listed on
    // its next read). One statement per query.
    for (const q0 of local) {
      await queryMutex.run(String(q0.queryId), async () => {
        const [q] = await db
          .select()
          .from(_mailQueries)
          .where(eq(_mailQueries.queryId, q0.queryId));
        if (!q) return; // evicted meanwhile
        const unverify = db
          .update(_mailQueries)
          .set({ verifiedCursor: null })
          .where(eq(_mailQueries.queryId, q.queryId));
        if (unverifyLocal || q.verifiedCursor !== from) {
          await unverify;
          return;
        }
        const filter =
          q.filter === null
            ? undefined
            : (decodeFilter(q.filter, MAIL_QUERY_COLUMNS) as Filter);
        const enter: { threadId: string; at: Date }[] = [];
        const leave: string[] = [];
        for (const s of summaries.values()) {
          const at = localMatchAt(s, filter);
          const claimed =
            at !== null &&
            (q.exhausted ||
              (q.floorAt !== null && at.getTime() > q.floorAt.getTime()));
          if (claimed) enter.push({ threadId: s.id, at: at! });
          else leave.push(s.id);
        }
        await writeAtomically(db, [
          enter.length === 0
            ? null
            : db
                .insert(_mailQueryMembers)
                .values(
                  enter.map((e) => ({
                    queryId: q.queryId,
                    accountId: a.id,
                    ...e,
                  })),
                )
                .onConflictDoUpdate({
                  target: [
                    _mailQueryMembers.queryId,
                    _mailQueryMembers.threadId,
                  ],
                  set: { at: sql`excluded.at` },
                }),
          leave.length === 0
            ? null
            : db
                .delete(_mailQueryMembers)
                .where(
                  and(
                    eq(_mailQueryMembers.queryId, q.queryId),
                    inArray(_mailQueryMembers.threadId, leave),
                  ),
                ),
          db
            .update(_mailQueries)
            .set({ verifiedCursor: a.cursor })
            .where(eq(_mailQueries.queryId, q.queryId)),
        ]);
      });
    }
  }

  // ── background ──────────────────────────────────────────────────────────

  function background(what: string, run: () => Promise<void>) {
    return async () => {
      try {
        await run();
      } catch (err) {
        // Offline or disconnected: the next read says so, typed. Anything
        // else is a failure to surface.
        if (
          err instanceof MailUnreachableError ||
          err instanceof MailNotConnectedError ||
          err instanceof ResourceRefusal
        )
          return;
        deps.onBackgroundError(what, err);
      }
    };
  }

  /**
   * One sync step of an account (design §5): its changes since the cursor
   * applied (`catchUp`), the outcome recorded on the account row — what
   * `mail.account-status` reads, so the status is as of the last step (a
   * read's, the tick's, the idle job's). Not connected and offline are
   * recorded, not reported; any other failure is recorded AND reported.
   */
  async function syncStep(accountId: string) {
    let failure: {
      kind: "offline" | "not-connected" | "fault";
      message: string;
    } | null = null;
    let recorded = true;
    try {
      recorded = await catchUp(accountId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        err instanceof MailNotConnectedError ||
        err instanceof ResourceRefusal
      ) {
        // `account()` refuses not-connected (and offline with nothing held,
        // which a held account with a cursor never is).
        failure = { kind: "not-connected", message };
      } else if (err instanceof MailUnreachableError) {
        failure = { kind: "offline", message };
      } else {
        failure = { kind: "fault", message };
        deps.onBackgroundError("sync", err);
      }
    }
    if (recorded) {
      const now = new Date();
      await db
        .update(_mailAccounts)
        .set(
          failure === null
            ? { syncedAt: now, syncFailure: null }
            : { syncFailure: { at: now.toISOString(), ...failure } },
        )
        .where(eq(_mailAccounts.id, accountId));
    }
    deps.notifyStatus();
  }

  // The account's sync step, serialised and coalesced per account: a read's
  // catch-up, the fallback tick and the idle job fold into one trailing run.
  const catchUps = createKeyedCoalescer<string>({
    name: "mail-cache-catch-up",
    run: (accountId) => syncStep(accountId),
  });
  const relists = createKeyedCoalescer<number>({
    name: "mail-cache-relist",
    run: (queryId) =>
      background("re-list", async () => relist(await account(), queryId))(),
  });

  // ── the served answers ──────────────────────────────────────────────────

  async function window(w: MailWindowQuery): Promise<MailThreadRow[]> {
    const a = await account();
    const mailboxes = await mailboxesOf(a);
    const canonical = canonicalizeFilter(
      w.where as MailQuery,
      MAIL_QUERY_COLUMNS,
    ) as Filter | undefined;
    const compiled = a.definition.compileQuery(canonical as MailQuery, {
      mailboxes,
    });
    if (compiled.kind === "refused") {
      const r = compiled.refusal;
      throw deps.refuse(
        "filter-refused",
        `${r.message} (rule: ${r.column} ${r.op}, ${r.reason})`,
      );
    }
    if (compiled.kind === "nothing") return [];
    const qr0 = await queryRow(a, compiled.providerQuery, canonical);
    const qr = await queryMutex.run(String(qr0.queryId), async () => {
      const current = await queryById(qr0.queryId);
      if ((await missing(current, w)) === 0) return current;
      const uncovered = current.floorAt === null && !current.exhausted;
      const filled = await orRefuse("this view", () =>
        fill(a, qr0.queryId, (q) => missing(q, w), fg),
      );
      if (!uncovered) return filled;
      // Listed from the head just now: the provider's answer as of (at least)
      // the cursor its summaries are current at.
      await db
        .update(_mailQueries)
        .set({ verifiedCursor: a.cursor })
        .where(eq(_mailQueries.queryId, qr0.queryId));
      return queryById(qr0.queryId);
    });
    const rows = await answer(a, qr, w);
    catchUps.trigger(a.id);
    if (qr.verifiedCursor !== a.cursor) relists.trigger(qr.queryId);
    return rows;
  }

  async function rows(ids: readonly string[]): Promise<MailThreadRow[]> {
    const a = await account();
    if (ids.length === 0) return [];
    const found = await db
      .select({ summary: _mailThreads.summary })
      .from(_mailThreads)
      .where(
        and(
          eq(_mailThreads.accountId, a.id),
          inArray(_mailThreads.threadId, [...ids]),
        ),
      );
    return found.map((r) => {
      const s = loadSummary(r.summary);
      return rowOf(s, s.lastMessageAt);
    });
  }

  async function mailboxes(): Promise<MailMailboxRow[]> {
    const a = await account();
    return (await mailboxesOf(a)).map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      kind: m.kind,
      parentId: m.parentId,
      threadsTotal: m.counts?.threads ?? null,
      threadsUnread: m.counts?.unread ?? null,
      color: m.color,
    }));
  }

  /**
   * One sync step of every account the cache holds (v1: one) — the change
   * signal's entry (the fallback tick, the idle job). An account never read
   * (no cursor) has nothing to catch up. (When the connected account is
   * another address, the step is `account()`'s: the old cache is dropped
   * and the new account's row made, as any read would.)
   */
  async function sync(): Promise<void> {
    const held = await db
      .select({ id: _mailAccounts.id })
      .from(_mailAccounts)
      .where(isNotNull(_mailAccounts.cursor));
    for (const r of held) await catchUps.run(r.id);
  }

  /**
   * `mail.account-status`, read from the account row alone: the connection
   * as the last sync step found it (no connection read here — it has no
   * change signal; the next step, at the latest the next read or tick,
   * records a reconnect or a revocation).
   */
  async function status(): Promise<MailAccountStatus> {
    const definition = deps.definition();
    const [row] = await db
      .select()
      .from(_mailAccounts)
      .where(eq(_mailAccounts.providerId, definition.id))
      .orderBy(desc(_mailAccounts.createdAt))
      .limit(1);
    if (!row || row.cursor === null) return { kind: "none" };
    const f = row.syncFailure;
    if (f?.kind === "not-connected") {
      return {
        kind: "not-connected",
        address: row.address,
        message: f.message,
      };
    }
    return {
      kind: "account",
      address: row.address,
      connection: f?.kind === "offline" ? "offline" : "connected",
      changeSignal: deps.changeSignal(),
      syncedAt: row.syncedAt?.toISOString() ?? null,
      syncFailure:
        f === null ? null : { at: f.at, kind: f.kind, message: f.message },
    };
  }

  return {
    window,
    rows,
    mailboxes,
    sync,
    status,
    /** Test seams: run a catch-up / settle the background work. */
    catchUp: async () => catchUps.run((await account()).id),
    settled: async () => {
      const a = await account();
      await catchUps.settled(a.id);
    },
    relistSettled: (queryId: number) => relists.settled(queryId),
  };
}

export type MailCache = ReturnType<typeof createMailCache>;
