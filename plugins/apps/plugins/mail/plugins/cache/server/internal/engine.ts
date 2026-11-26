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
import { z } from "zod";
import { writeAtomically, type Db } from "@plugins/database/server";
import { NonRetryableError } from "@plugins/infra/plugins/jobs/server";
import { executeRows } from "@plugins/database/plugins/sql-rows/core";
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
import { createInflight } from "@plugins/packages/plugins/inflight/core";
import {
  changeCursor,
  MAIL_QUERY_COLUMNS,
  MailNotConnectedError,
  MailUnreachableError,
  providerQuery,
  messageId as toMessageId,
  threadId as toThreadId,
  type AttachmentMeta,
  type ChangeCursor,
  type Mailbox,
  type MailboxId,
  type MailCallOptions,
  type MailProvider,
  type MailProviderDefinition,
  type MailQuery,
  type MailWriteTarget,
  type ThreadContent,
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
  _mailThreadBodies,
  _mailThreads,
} from "./tables";
import { loadSummary, storeSummary } from "./stored-summary";
import { contentBytes, loadContent, storeContent } from "./stored-content";
import { bodyAnswers, MAIL_BODY_BUDGET_BYTES, readerContent } from "./bodies";
import {
  applyMailOp,
  mailInboxView,
  mailOpMoves,
  undoMailOp,
  type MailAccountStatus,
  type MailOpUndo,
  type MailThreadOp,
} from "../../core";

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
/** Threads either side of the one being read whose bodies are prefetched. */
const PREFETCH_NEIGHBOURS = 3;
/** The head of each recently read view whose bodies are prefetched. */
const PREFETCH_VIEW_TOP = 25;
/** The Inbox's first page, whose unread threads' bodies are prefetched. */
const PREFETCH_INBOX_PAGE = 50;
/** A view read this recently is prefetched (design §3: the last day). */
const PREFETCH_RECENT_MS = 24 * 60 * 60 * 1000;

/**
 * Why a thread cannot be read: `gone` (deleted at the provider, or no such
 * thread), `not-connected` (the account needs reconnecting), or
 * `offline-not-cached` (the provider cannot be reached and the cache holds
 * no current body for it). The reader's value refuses with the reason.
 */
export class MailThreadUnavailableError extends Error {
  override name = "MailThreadUnavailableError";
  constructor(
    readonly reason: "gone" | "not-connected" | "offline-not-cached",
    message: string,
  ) {
    super(message);
  }
}

/**
 * One thread as the reader reads it: its summary (current at the account's
 * change cursor) and its content, the summary's per-message facts over it.
 */
export type MailThreadRead = {
  summary: ThreadSummary;
  content: ThreadContent;
};

/** One attachment's description and bytes, from the provider. */
export type MailAttachmentRead = { meta: AttachmentMeta; bytes: Uint8Array };

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
  /** The stored bodies' byte budget, read per store (default {@link MAIL_BODY_BUDGET_BYTES}). */
  bodyBudgetBytes?: () => number;
  /**
   * Body prefetch (design §3), through the provider's background priority:
   * at most `perRun()` bodies a run (read per run; 0: none), a run after each
   * window read, thread open and sync step that moved mail. Absent: no
   * prefetch (tests that count provider calls).
   */
  prefetch?: { perRun: () => number };
  /**
   * Hands a triage op to the durable queue (`mail.apply-op`), which calls
   * `applyAtProvider` with it — after the cache already holds its prediction.
   */
  enqueueOp: (job: MailOpJob) => Promise<void>;
};

/** A triage op as the durable job carries it: the account, the op, what it acts on. */
export type MailOpJob = {
  accountId: string;
  /** The op's own id: what its pending entry is dropped by once it lands. */
  opId: string;
  op: MailThreadOp;
  targets: { thread: string; messages: string[] }[];
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

/** Postgres' foreign_key_violation (23503), on the error or its cause (drizzle wraps). */
function isForeignKeyViolation(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === "23503") return true;
  }
  return false;
}

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

  /**
   * The window's rows from coverage. `touch` stamps the threads' use for
   * retention — a read the user made; a boot preload is not one (it writes
   * nothing).
   */
  async function answer(
    a: Pick<Account, "id">,
    qr: QueryRow,
    w: MailWindowQuery,
    touch = true,
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
    const used = touch
      ? rows
          .filter((r) => now - r.lastUsedAt.getTime() > USED_TOUCH_MS)
          .map((r) => r.threadId)
      : [];
    if (used.length > 0) {
      await db
        .update(t)
        .set({ lastUsedAt: new Date(now) })
        .where(and(eq(t.accountId, a.id), inArray(t.threadId, used)));
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
      // An op still pending on the thread is laid over what the provider
      // said (its write has not landed): what is stored and what the
      // caller re-checks membership on.
      if (r.kind === "found") out.set(r.id, withPending(r.summary));
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
   *
   * The provider is read OUTSIDE the query's lock, which is taken only to
   * write: a re-list runs at background priority, and its paced calls wait
   * for room behind every foreground call — under the lock, a person's read
   * of the same query (a fill, at foreground) waited on that background
   * work, pacer waits included (27 s on `mutex:mail-cache-query`,
   * report-1795721325-z5j6zz). Written only if the query is still as the
   * re-list found it (its coverage and its verified cursor): a fill, a read's
   * own listing or a catch-up that moved it meanwhile is newer than this
   * answer, and a query left unverified is re-listed by its next read. A
   * triage op's re-check moves members without touching those, so a thread
   * with an op still pending keeps its membership as it stands.
   */
  async function relist(a: Account, queryId: number) {
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
    await queryMutex.run(String(queryId), async () => {
      const [q] = await db
        .select()
        .from(_mailQueries)
        .where(eq(_mailQueries.queryId, queryId));
      if (
        !q ||
        q.verifiedCursor !== before.verifiedCursor ||
        q.exhausted !== before.exhausted ||
        (q.floorAt?.getTime() ?? null) !== (before.floorAt?.getTime() ?? null)
      )
        return;
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
      // A thread with a triage op not yet written to the provider keeps the
      // membership the op's re-check gave it: the provider's listing may
      // predate the write (an archived thread still listed in the Inbox).
      const now = new Map(
        [...found].filter(([id, at]) => above(at) && !pendingOps.has(id)),
      );
      for (const [id, at] of was) if (pendingOps.has(id)) now.set(id, at);
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
      if (moved.size > 0) {
        deps.notifyThreads([...moved]);
        prefetches.trigger(a.id);
      }
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

  // ── thread content (the reader, design §3–4) ───────────────────────────

  const budget = deps.bodyBudgetBytes ?? (() => MAIL_BODY_BUDGET_BYTES);
  const contentFlights = createInflight("mail-thread-content");
  /** The thread each account last opened: whose neighbours are prefetched. */
  const lastOpened = new Map<string, string>();

  /** `id`'s summary, current: cached and not stale, else re-read (null: gone). */
  async function currentSummary(
    a: Account,
    id: string,
    o: MailCallOptions,
  ): Promise<ThreadSummary | null> {
    const [r] = await db
      .select({ summary: _mailThreads.summary, stale: _mailThreads.stale })
      .from(_mailThreads)
      .where(
        and(eq(_mailThreads.accountId, a.id), eq(_mailThreads.threadId, id)),
      );
    if (r && !r.stale) return loadSummary(r.summary);
    try {
      const fetched = await fetchSummaries(a, [toThreadId(id)], o);
      return fetched.get(id) ?? null;
    } catch (err) {
      // Offline, a summary not known current still answers (a cached
      // answer stands while the provider cannot be reached; the next read
      // online re-reads it).
      if (err instanceof MailUnreachableError && r) {
        return loadSummary(r.summary);
      }
      throw err;
    }
  }

  /**
   * Fetches `id`'s content from the provider and stores it (one flight per
   * thread: an open joins the prefetch of the same thread), its summary read
   * again when the two disagree on the messages (the thread moved between
   * the reads). Null: gone.
   */
  function fetchBody(
    a: Account,
    id: string,
    o: MailCallOptions,
  ): Promise<MailThreadRead | null> {
    // Keyed by priority too: an open never waits on a prefetch's
    // background-priority fetch of the same thread.
    return contentFlights.run(`${a.id}\0${id}\0${o.priority}`, async () => {
      let summary = await currentSummary(a, id, o);
      if (summary === null) return null;
      const r = await a.provider.getThreadContent(toThreadId(id), o);
      if (r.kind === "gone") {
        await deleteThreads(a.id, [id]);
        return null;
      }
      const ids = r.content.messages.map((m) => m.id as string);
      if (!bodyAnswers(ids, summary)) {
        const fresh = await fetchSummaries(a, [toThreadId(id)], o);
        summary = fresh.get(id) ?? null;
        if (summary === null) return null;
        // The list showed the thread as it was: it re-reads it.
        deps.notifyThreads([id]);
      }
      const now = new Date();
      try {
        await db
          .insert(_mailThreadBodies)
          .values({
            accountId: a.id,
            threadId: id,
            version: r.content.version,
            messageIds: ids,
            content: storeContent(r.content),
            bytes: contentBytes(r.content),
            fetchedAt: now,
            openedAt: null,
          })
          .onConflictDoUpdate({
            target: [_mailThreadBodies.accountId, _mailThreadBodies.threadId],
            set: {
              version: sql`excluded.version`,
              messageIds: sql`excluded.message_ids`,
              content: sql`excluded.content`,
              bytes: sql`excluded.bytes`,
              fetchedAt: now,
            },
          });
      } catch (err) {
        // Its thread was deleted meanwhile (a sync step found it gone, the
        // retention sweep): gone, as the provider would say.
        if (isForeignKeyViolation(err)) return null;
        throw err;
      }
      await evictBodies(a.id, id);
      return { summary, content: r.content };
    });
  }

  /**
   * Holds the stored bodies under the byte budget: the least recently opened
   * (a prefetched one by when it was fetched) go first, never `keep` (the
   * body just stored). An evicted body is fetched again on its next open.
   */
  async function evictBodies(accountId: string, keep: string) {
    const over = await executeRows(db, {
      row: z.object({ thread_id: z.string() }),
      query: sql`
        select thread_id from (
          select thread_id, sum(bytes) over (
            order by coalesce(opened_at, fetched_at) desc, thread_id collate "C"
          ) as running
          from ${_mailThreadBodies} where account_id = ${accountId}
        ) r
        where r.running > ${budget()} and r.thread_id <> ${keep}`,
    });
    if (over.length === 0) return;
    await db.delete(_mailThreadBodies).where(
      and(
        eq(_mailThreadBodies.accountId, accountId),
        inArray(
          _mailThreadBodies.threadId,
          over.map((r) => r.thread_id),
        ),
      ),
    );
  }

  /** The provider's typed failures as the thread's reasons; anything else as is. */
  function unavailable(err: unknown): unknown {
    if (err instanceof MailThreadUnavailableError) return err;
    if (err instanceof MailNotConnectedError) {
      return new MailThreadUnavailableError("not-connected", err.message);
    }
    if (err instanceof MailUnreachableError) {
      return new MailThreadUnavailableError(
        "offline-not-cached",
        `Offline: this conversation is not cached (${err.message})`,
      );
    }
    // `account()` refuses as the threads window does (not connected, or
    // offline with nothing held).
    if (err instanceof ResourceRefusal) {
      return new MailThreadUnavailableError(
        err.code === "not-connected" ? "not-connected" : "offline-not-cached",
        err.message,
      );
    }
    return err;
  }

  /** `id` as the reader reads it, its body from the store when it still answers, else fetched. */
  async function readThread(
    id: string,
    open: boolean,
  ): Promise<{ a: Account; read: MailThreadRead }> {
    try {
      const a = await account();
      const summary = await currentSummary(a, id, fg);
      if (summary === null) {
        throw new MailThreadUnavailableError(
          "gone",
          "This conversation is no longer in the mailbox.",
        );
      }
      const [b] = await db
        .select({
          messageIds: _mailThreadBodies.messageIds,
          content: _mailThreadBodies.content,
        })
        .from(_mailThreadBodies)
        .where(
          and(
            eq(_mailThreadBodies.accountId, a.id),
            eq(_mailThreadBodies.threadId, id),
          ),
        );
      let read: MailThreadRead | null =
        b && bodyAnswers(b.messageIds, summary)
          ? { summary, content: loadContent(b.content) }
          : null;
      read ??= await fetchBody(a, id, fg);
      if (read === null) {
        throw new MailThreadUnavailableError(
          "gone",
          "This conversation is no longer in the mailbox.",
        );
      }
      if (open) {
        const now = new Date();
        await writeAtomically(db, [
          db
            .update(_mailThreadBodies)
            .set({ openedAt: now })
            .where(
              and(
                eq(_mailThreadBodies.accountId, a.id),
                eq(_mailThreadBodies.threadId, id),
              ),
            ),
          db
            .update(_mailThreads)
            .set({ lastUsedAt: now })
            .where(
              and(
                eq(_mailThreads.accountId, a.id),
                eq(_mailThreads.threadId, id),
              ),
            ),
        ]);
      }
      return {
        a,
        read: {
          summary: read.summary,
          content: readerContent(read.content, read.summary),
        },
      };
    } catch (err) {
      throw unavailable(err);
    }
  }

  /**
   * One thread as the reader opens it (the `mail.thread` value): from the
   * stored body while it holds exactly the thread's messages, else fetched
   * from the provider (foreground). Opening records the thread's neighbours
   * for prefetch. Marks nothing read.
   */
  async function thread(id: string): Promise<MailThreadRead> {
    const { a, read } = await readThread(id, true);
    lastOpened.set(a.id, id);
    prefetches.trigger(a.id);
    return read;
  }

  /** One attachment of a message of `id`: its description from the body, its bytes from the provider. */
  async function attachment(
    id: string,
    message: string,
    partId: string,
  ): Promise<MailAttachmentRead> {
    const { a, read } = await readThread(id, false);
    const meta = read.content.messages
      .find((m) => m.id === message)
      ?.attachments.find((x) => x.ref.partId === partId);
    if (meta === undefined) {
      throw new MailThreadUnavailableError(
        "gone",
        `This conversation has no attachment ${partId} on message ${message}.`,
      );
    }
    try {
      return { meta, bytes: await a.provider.getAttachment(meta.ref, fg) };
    } catch (err) {
      throw unavailable(err);
    }
  }

  /**
   * The threads whose bodies prefetch wants, most wanted first: the open
   * thread's neighbours in the view it was opened from (the most recently
   * read query holding it), the Inbox's unread first page, then the head of
   * every view read in the last day.
   */
  async function prefetchCandidates(a: Account): Promise<string[]> {
    const m = _mailQueryMembers;
    const q = _mailQueries;
    const out = new Set<string>();
    const opened = lastOpened.get(a.id);
    if (opened !== undefined) {
      const [home] = await db
        .select({ queryId: m.queryId, at: m.at })
        .from(m)
        .innerJoin(q, eq(q.queryId, m.queryId))
        .where(and(eq(m.accountId, a.id), eq(m.threadId, opened)))
        .orderBy(desc(q.lastReadAt))
        .limit(1);
      if (home) {
        const near = (newer: boolean) =>
          db
            .select({ threadId: m.threadId })
            .from(m)
            .where(
              and(
                eq(m.queryId, home.queryId),
                newer
                  ? or(
                      gt(m.at, home.at),
                      and(
                        eq(m.at, home.at),
                        sql`${collateC(m.threadId)} < ${opened}`,
                      ),
                    )
                  : or(
                      lt(m.at, home.at),
                      and(
                        eq(m.at, home.at),
                        sql`${collateC(m.threadId)} > ${opened}`,
                      ),
                    ),
              ),
            )
            .orderBy(
              newer ? asc(m.at) : desc(m.at),
              newer ? sql`${collateC(m.threadId)} desc` : collateC(m.threadId),
            )
            .limit(PREFETCH_NEIGHBOURS);
        const [older, newer] = await Promise.all([near(false), near(true)]);
        for (let i = 0; i < PREFETCH_NEIGHBOURS; i++) {
          if (older[i]) out.add(older[i]!.threadId);
          if (newer[i]) out.add(newer[i]!.threadId);
        }
      }
    }
    const mailboxes = await cachedMailboxes(a.id);
    if (mailboxes.length > 0) {
      const inbox = a.definition.compileQuery(
        canonicalizeFilter(
          mailInboxView.where as MailQuery,
          MAIL_QUERY_COLUMNS,
        ) as MailQuery,
        { mailboxes },
      );
      if (inbox.kind === "query") {
        const unread = await db
          .select({ threadId: m.threadId })
          .from(m)
          .innerJoin(q, eq(q.queryId, m.queryId))
          .innerJoin(
            _mailThreads,
            and(
              eq(_mailThreads.accountId, m.accountId),
              eq(_mailThreads.threadId, m.threadId),
            ),
          )
          .where(
            and(
              eq(q.accountId, a.id),
              eq(q.providerQuery, inbox.providerQuery),
              sql`(${_mailThreads.summary}->>'unread')::boolean`,
            ),
          )
          .orderBy(desc(m.at), collateC(m.threadId))
          .limit(PREFETCH_INBOX_PAGE);
        for (const r of unread) out.add(r.threadId);
      }
    }
    const heads = await executeRows(db, {
      row: z.object({ thread_id: z.string() }),
      query: sql`
      select thread_id from (
        select m.thread_id, q.last_read_at,
          row_number() over (partition by m.query_id order by m.at desc, m.thread_id collate "C") as rn
        from ${m} m join ${q} q on q.query_id = m.query_id
        where q.account_id = ${a.id}
          and q.last_read_at > ${new Date(wallNow("retention") - PREFETCH_RECENT_MS)}
      ) h where rn <= ${PREFETCH_VIEW_TOP}
      order by last_read_at desc, rn`,
    });
    for (const r of heads) out.add(r.thread_id);
    return [...out];
  }

  /** One prefetch run: the wanted bodies not stored (or stale), at most `perRun`, background priority. */
  async function prefetchRun(accountId: string) {
    const perRun = deps.prefetch?.perRun() ?? 0;
    if (perRun === 0) return;
    const a = await account();
    if (a.id !== accountId) return;
    const wanted = await prefetchCandidates(a);
    if (wanted.length === 0) return;
    const rows = await db
      .select({
        threadId: _mailThreads.threadId,
        summary: _mailThreads.summary,
        stale: _mailThreads.stale,
        messageIds: _mailThreadBodies.messageIds,
      })
      .from(_mailThreads)
      .leftJoin(
        _mailThreadBodies,
        and(
          eq(_mailThreadBodies.accountId, _mailThreads.accountId),
          eq(_mailThreadBodies.threadId, _mailThreads.threadId),
        ),
      )
      .where(
        and(
          eq(_mailThreads.accountId, a.id),
          inArray(_mailThreads.threadId, wanted),
        ),
      );
    const byId = new Map(rows.map((r) => [r.threadId, r]));
    const need = wanted.filter((id) => {
      const r = byId.get(id);
      // A stale summary is re-read when the thread is listed or opened.
      if (!r || r.stale) return false;
      return (
        r.messageIds === null ||
        !bodyAnswers(r.messageIds, loadSummary(r.summary))
      );
    });
    for (const id of need.slice(0, perRun)) await fetchBody(a, id, bg);
  }

  const prefetches = createKeyedCoalescer<string>({
    name: "mail-cache-prefetch",
    run: (accountId) => background("prefetch", () => prefetchRun(accountId))(),
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
    prefetches.trigger(a.id);
    if (qr.verifiedCursor !== a.cursor) relists.trigger(qr.queryId);
    return rows;
  }

  /**
   * The window from what the cache already holds — no provider call, not
   * even the connection check (a token refresh can reach Google), and no
   * write: the one account the cache holds for the provider, its cached
   * mailboxes, the query's coverage. `{ held: false }` whenever any of them
   * is missing or coverage does not answer the window whole. What a boot
   * preload reads (`preloadWindows`). Not checking the connection, it
   * answers for the account the cache last served: after a disconnect, or a
   * switch to another Google account, those stored rows show for the instant
   * until the live read (`window`) refuses `not-connected` or drops that
   * account's cache and answers the new one.
   */
  async function held(
    w: MailWindowQuery,
  ): Promise<{ held: true; rows: MailThreadRow[] } | { held: false }> {
    const definition = deps.definition();
    const accounts = await db
      .select()
      .from(_mailAccounts)
      .where(eq(_mailAccounts.providerId, definition.id));
    const [row] = accounts;
    if (accounts.length !== 1 || row!.cursor === null) return { held: false };
    const mailboxes = await cachedMailboxes(row!.id);
    if (mailboxes.length === 0) return { held: false };
    const canonical = canonicalizeFilter(
      w.where as MailQuery,
      MAIL_QUERY_COLUMNS,
    ) as Filter | undefined;
    const compiled = definition.compileQuery(canonical as MailQuery, {
      mailboxes,
    });
    if (compiled.kind === "refused") return { held: false };
    if (compiled.kind === "nothing") return { held: true, rows: [] };
    const [qr] = await db
      .select()
      .from(_mailQueries)
      .where(
        and(
          eq(_mailQueries.accountId, row!.id),
          eq(_mailQueries.providerQuery, compiled.providerQuery),
        ),
      );
    if (!qr || (await missing(qr, w)) > 0) return { held: false };
    const a: Pick<Account, "id"> = { id: row!.id };
    return { held: true, rows: await answer(a, qr, w, false) };
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

  // ── triage (design §6) ──────────────────────────────────────────────────

  /**
   * Applies `op` to threads `ids` — the cache first, the provider after:
   * each thread's summary is rewritten as the op leaves it (`applyMailOp`
   * per message, the same reducer the browser predicts with), every locally
   * maintained query re-checked on it (a thread archived leaves the Inbox,
   * enters Done), every provider-evaluated query holding it unverified (its
   * next read re-lists it), the windows notified — and the provider's write
   * handed to the durable queue (`deps.enqueueOp`), which retries it through
   * an outage and, should it fail for good, re-reads the threads from the
   * provider (`restoreThreads`): the provider's state is the truth.
   *
   * A thread not cached is read first (its messages are what the write acts
   * on); one gone at the provider is skipped.
   */
  async function apply(
    ids: readonly string[],
    op: MailThreadOp,
  ): Promise<MailOpUndo[]> {
    const a = await account();
    const cachedIds = new Set(
      (
        await db
          .select({ threadId: _mailThreads.threadId })
          .from(_mailThreads)
          .where(
            and(
              eq(_mailThreads.accountId, a.id),
              inArray(_mailThreads.threadId, [...ids]),
            ),
          )
      ).map((r) => r.threadId),
    );
    const missing = ids.filter((id) => !cachedIds.has(id)).map(toThreadId);
    if (missing.length > 0) {
      await orRefuse("the threads", () => fetchSummaries(a, missing, fg));
    }
    // Pending from here until the provider holds it: every summary the
    // cache writes for these threads meanwhile (a sync step, a fill) has the
    // op laid over it, so a re-read of the provider's pre-op state never
    // undoes the prediction.
    const opId = crypto.randomUUID();
    for (const id of ids) {
      pendingOps.set(id, [...(pendingOps.get(id) ?? []), { opId, op }]);
    }
    try {
      // The prediction and the threads as they were, read and written in
      // one transaction with the rows locked: a sync step's upsert of the
      // same thread waits, then lays the pending op over what it read.
      const { before, after } = await db.transaction(async (tx) => {
        const rows = await tx
          .select({
            threadId: _mailThreads.threadId,
            summary: _mailThreads.summary,
          })
          .from(_mailThreads)
          .where(
            and(
              eq(_mailThreads.accountId, a.id),
              inArray(_mailThreads.threadId, [...ids]),
            ),
          )
          .for("update");
        const before = rows.map((r) => loadSummary(r.summary));
        const after = before.map((s) => predictSummary(s, op));
        for (const s of after) {
          await tx
            .update(_mailThreads)
            .set({ summary: storeSummary(s) })
            .where(
              and(
                eq(_mailThreads.accountId, a.id),
                eq(_mailThreads.threadId, s.id),
              ),
            );
        }
        return { before, after };
      });
      if (after.length === 0) {
        dropPending(opId);
        return [];
      }
      // Queued before anything is shown: a write the queue refused is a
      // failed request (the browser says so), never a prediction alone.
      await deps.enqueueOp({
        accountId: a.id,
        opId,
        op,
        targets: before.map((s) => ({
          thread: s.id,
          messages: s.messages.map((m) => m.id),
        })),
      });
      await recheckMembership(a, after);
      deps.notifyThreads(after.map((s) => s.id));
      return undoMailOp(
        op,
        before.map((s) => ({
          id: s.id,
          facts: { mailboxes: s.mailboxes, unread: s.unread },
        })),
      );
    } catch (err) {
      dropPending(opId);
      throw err;
    }
  }

  /** Ops written to the cache whose provider write has not landed yet, per thread, oldest first. */
  const pendingOps = new Map<string, { opId: string; op: MailThreadOp }[]>();

  function dropPending(opId: string): void {
    for (const [id, list] of pendingOps) {
      const rest = list.filter((p) => p.opId !== opId);
      if (rest.length === 0) pendingOps.delete(id);
      else pendingOps.set(id, rest);
    }
  }

  /** A summary read from the provider, with the ops still pending on it laid over. */
  function withPending(s: ThreadSummary): ThreadSummary {
    const list = pendingOps.get(s.id);
    if (list === undefined) return s;
    return list.reduce((acc, p) => predictSummary(acc, p.op), s);
  }

  /** A summary as `op` leaves it: each message's facts, then the thread's unions. */
  function predictSummary(s: ThreadSummary, op: MailThreadOp): ThreadSummary {
    const messages = s.messages.map((m) => {
      const next = applyMailOp(
        { mailboxes: m.mailboxes as string[], unread: m.unread },
        op,
      );
      return {
        ...m,
        mailboxes: next.mailboxes as MailboxId[],
        unread: next.unread,
      };
    });
    return {
      ...s,
      messages,
      mailboxes: [...new Set(messages.flatMap((m) => m.mailboxes))],
      unread: messages.some((m) => m.unread),
    };
  }

  /**
   * Re-checks membership after the cache itself moved threads: every
   * verified locally maintained query re-decided per message on them (in or
   * out, its cursor kept — the provider has not reported this yet, and its
   * report re-checks again); every other query holding one unverified.
   * Measured before this was lock-free: a label click waited 43.6 s on the
   * Done view's cold fill holding the query's lock.
   */
  async function recheckMembership(a: Account, list: ThreadSummary[]) {
    const ids = list.map((s) => s.id);
    const queries = await db
      .select()
      .from(_mailQueries)
      .where(eq(_mailQueries.accountId, a.id));
    const held = await db
      .selectDistinct({ queryId: _mailQueryMembers.queryId })
      .from(_mailQueryMembers)
      .where(
        and(
          eq(_mailQueryMembers.accountId, a.id),
          inArray(_mailQueryMembers.threadId, ids),
        ),
      );
    const holding = new Set(held.map((r) => r.queryId));
    const stale = queries
      .filter((q) => !q.locallyMaintained && holding.has(q.queryId))
      .map((q) => q.queryId);
    if (stale.length > 0) {
      await db
        .update(_mailQueries)
        .set({ verifiedCursor: null })
        .where(inArray(_mailQueries.queryId, stale));
    }
    // NOT under the query's lock: a fill holds it across provider calls
    // (seconds, more when the pacer waits), and a click must not wait on a
    // background fill. Each write below is one idempotent statement. The one
    // race left — a fill that read a thread's summary before the prediction
    // re-adding it after this — is undone by the provider's own report of
    // the write: the next sync step re-checks the thread under the lock.
    for (const q of queries) {
      if (!q.locallyMaintained || q.verifiedCursor === null) continue;
      const filter =
        q.filter === null
          ? undefined
          : (decodeFilter(q.filter, MAIL_QUERY_COLUMNS) as Filter);
      const enter: { threadId: string; at: Date }[] = [];
      const leave: string[] = [];
      for (const s of list) {
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
                target: [_mailQueryMembers.queryId, _mailQueryMembers.threadId],
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
      ]);
    }
  }

  /**
   * The durable half of `apply` (the `mail.apply-op` job): the provider's
   * write. Offline throws (the job retries). An op for an account the cache
   * no longer serves (another mailbox connected since) is dropped.
   */
  async function applyAtProvider(job: MailOpJob): Promise<void> {
    try {
      await writeAtProvider(job);
    } catch (err) {
      // Offline or the grant: retried (the queue's attempts). Anything else
      // the provider refused will be refused again: not retried, so it does
      // not hold every later op (the queue is serial).
      if (
        err instanceof MailUnreachableError ||
        err instanceof MailNotConnectedError
      )
        throw err;
      throw new NonRetryableError(
        `mail: the provider refused ${job.op.kind}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    dropPending(job.opId);
  }

  async function writeAtProvider(job: MailOpJob): Promise<void> {
    const a = await account();
    if (a.id !== job.accountId) return;
    const targets: MailWriteTarget[] = job.targets.map((t) => ({
      thread: toThreadId(t.thread),
      messages: t.messages.map(toMessageId),
    }));
    const op = job.op;
    const p = a.provider;
    switch (op.kind) {
      case "archive":
        return p.archive(targets, fg);
      case "move-to-inbox":
        return p.moveToInbox(targets, fg);
      case "trash":
        return p.trash(targets, fg);
      case "read":
        return p.setFlags(targets, { unread: op.unread }, fg);
      case "spam":
      case "not-spam":
      case "labels": {
        const { add, remove } = mailOpMoves(op);
        return p.setMailboxes(
          targets,
          { add: add as MailboxId[], remove: remove as MailboxId[] },
          fg,
        );
      }
    }
  }

  /**
   * A triage op that failed for good: its threads re-read from the provider
   * (the truth), their membership re-checked and the windows notified — the
   * prediction gives way to what the provider holds.
   */
  async function restoreThreads(job: MailOpJob): Promise<void> {
    dropPending(job.opId);
    const ids = job.targets.map((t) => t.thread);
    // Database only (it must work offline, the likely reason it gave up):
    // the threads stale (re-read on their next listing or open), the
    // queries unverified (re-listed on their next read).
    await db
      .update(_mailThreads)
      .set({ stale: true })
      .where(
        and(
          eq(_mailThreads.accountId, job.accountId),
          inArray(_mailThreads.threadId, ids),
        ),
      );
    // Every query unverified, not only those holding the threads: the
    // prediction took them out of some (the Inbox an archive left), and only
    // a re-list says where they are. Rare (an op the queue gave up on), and
    // each re-list is one list call on that query's next read.
    await db
      .update(_mailQueries)
      .set({ verifiedCursor: null })
      .where(eq(_mailQueries.accountId, job.accountId));
    deps.notifyThreads(ids);
  }

  // ── labels (mailboxes the user makes) ──────────────────────────────────

  /**
   * Makes the label at `path` ("Travel/Ski 2027"): each missing level created
   * under the one before it, the existing ones kept; the mailboxes relisted.
   * Answers the last level's id.
   */
  async function createLabel(path: string): Promise<MailboxId> {
    const a = await account();
    const names = path
      .split("/")
      .map((n) => n.trim())
      .filter((n) => n !== "");
    if (names.length === 0) throw new Error("mail: a label needs a name");
    const all = await mailboxesOf(a);
    let parent: MailboxId | null = null;
    for (const name of names) {
      const existing = all.find(
        (m) => m.kind === "user" && m.parentId === parent && m.name === name,
      );
      if (existing) {
        parent = existing.id;
        continue;
      }
      const made = await a.provider.createMailbox(
        { name, parentId: parent },
        fg,
      );
      all.push(made);
      parent = made.id;
    }
    await relistMailboxes(a, fg);
    return parent!;
  }

  async function renameLabel(id: string, name: string): Promise<void> {
    const a = await account();
    await a.provider.renameMailbox(id as MailboxId, name.trim(), fg);
    await relistMailboxes(a, fg);
  }

  /** Deletes a label (its sub-labels stay, as Gmail keeps them); threads keep their other labels. */
  async function deleteLabel(id: string): Promise<void> {
    const a = await account();
    await a.provider.deleteMailbox(id as MailboxId, fg);
    await relistMailboxes(a, fg);
  }

  return {
    apply,
    applyAtProvider,
    restoreThreads,
    createLabel,
    renameLabel,
    deleteLabel,
    window,
    held,
    rows,
    mailboxes,
    thread,
    attachment,
    sync,
    status,
    /** Test seams: run a catch-up / settle the background work. */
    catchUp: async () => catchUps.run((await account()).id),
    settled: async () => {
      const a = await account();
      await catchUps.settled(a.id);
    },
    relistSettled: (queryId: number) => relists.settled(queryId),
    prefetchSettled: async () => {
      const a = await account();
      await prefetches.settled(a.id);
    },
  };
}

export type MailCache = ReturnType<typeof createMailCache>;
