import { z } from "zod";
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { parsedJson } from "@plugins/database/plugins/sql-column/server";
import { externalIdColumn } from "@plugins/ids/server";
import { StoredSummarySchema } from "./stored-summary";

// The Mail cache (design §3: research/2026-11-26-apps-mail-on-demand-cache-provider.md).
// A CACHE of the provider's mail, loaded on demand: left out of worktree
// forks, backups and the change feed (the cache announces its own changes
// through the served collections' notify). Every row is keyed by its
// account, deleted with it. A load-order leaf: no other plugin's tables.

/** The connected account (v1: one): its provider, its address, and the change cursor the cached summaries are current at. */
export const _mailAccounts = pgTable("mail_accounts", {
  id: externalIdColumn("id", {
    reason:
      "the provider's own account id (MailProviderDefinition.connectedAccount)",
  }),
  providerId: text("provider_id").notNull(),
  address: text("address").notNull(),
  /** The cursor every cached summary is current at; null before the first read. */
  cursor: text("cursor"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Every mailbox of the account, with the provider's counts. Relisted whole. */
export const _mailMailboxes = pgTable(
  "mail_mailboxes",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => _mailAccounts.id, { onDelete: "cascade" }),
    mailboxId: text("mailbox_id").notNull(),
    name: text("name").notNull(),
    role: text("role"),
    kind: text("kind").notNull(),
    parentId: text("parent_id"),
    threadsTotal: integer("threads_total"),
    threadsUnread: integer("threads_unread"),
    color: parsedJson(
      "color",
      z.object({ text: z.string(), background: z.string() }),
    ),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.mailboxId] })],
);

/** One cached ThreadSummary per thread. */
export const _mailThreads = pgTable(
  "mail_threads",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => _mailAccounts.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    version: text("version").notNull(),
    summary: parsedJson("summary", StoredSummarySchema).notNull(),
    lastMessageAt: timestamp("last_message_at", {
      withTimezone: true,
    }).notNull(),
    /** Not known to be current (a change cursor reset): re-read before it is trusted. */
    stale: boolean("stale").notNull().default(false),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    /** Last answered in a window: what eviction keeps. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.threadId] }),
    index("mail_threads_last_used_idx").on(t.lastUsedAt),
  ],
);

/**
 * One row per distinct compiled query: its coverage. Every thread with a
 * matching message dated after `floorAt` (all of them when `exhausted`) is a
 * member, as of `verifiedCursor` (null: unverified — a change since may have
 * moved it, the next read revalidates). No coverage yet: `floorAt` null and
 * not exhausted.
 */
export const _mailQueries = pgTable(
  "mail_queries",
  {
    queryId: integer("query_id").primaryKey().generatedAlwaysAsIdentity(),
    accountId: text("account_id")
      .notNull()
      .references(() => _mailAccounts.id, { onDelete: "cascade" }),
    providerQuery: text("provider_query").notNull(),
    /** The canonical filter (encodeFilter), for the cache's own per-message re-check. */
    filter: text("filter"),
    /** Its columns are ones the cache holds exactly per message: membership kept by the cache itself. */
    locallyMaintained: boolean("locally_maintained").notNull(),
    /** Holds a free-text search: evicted after a day instead of thirty. */
    isSearch: boolean("is_search").notNull(),
    floorAt: timestamp("floor_at", { withTimezone: true }),
    exhausted: boolean("exhausted").notNull().default(false),
    verifiedCursor: text("verified_cursor"),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("mail_queries_account_query_uq").on(t.accountId, t.providerQuery),
    index("mail_queries_last_read_idx").on(t.lastReadAt),
  ],
);

/** A query's members, as far as covered: each thread at its latest matching message. */
export const _mailQueryMembers = pgTable(
  "mail_query_members",
  {
    queryId: integer("query_id")
      .notNull()
      .references(() => _mailQueries.queryId, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    threadId: text("thread_id").notNull(),
    /** The thread's latest message matching the query: its place in the window. */
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.queryId, t.threadId] }),
    foreignKey({
      columns: [t.accountId, t.threadId],
      foreignColumns: [_mailThreads.accountId, _mailThreads.threadId],
    }).onDelete("cascade"),
    index("mail_query_members_order_idx").on(
      t.queryId,
      t.at.desc(),
      t.threadId,
    ),
    index("mail_query_members_thread_idx").on(t.accountId, t.threadId),
  ],
);
