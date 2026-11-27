import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  max,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import {
  writeAtomically,
  type AtomicWrite,
  type Db,
  type DbExecutor,
} from "@plugins/database/server";
import { executeRows } from "@plugins/database/plugins/sql-rows/core";
import { filterSql } from "@plugins/network/plugins/live/plugins/filter/server";
import { wallNow } from "@plugins/packages/plugins/deadline/core";
import { parseMimeMessage } from "@plugins/packages/plugins/mime/core";
import {
  assertOutgoingMessageId,
  changeCursor,
  compileCanonicalMailQuery,
  decodeCanonicalMailQuery,
  deriveThreadSummary,
  draftId as toDraftId,
  listCursor,
  MAIL_QUERY_COLUMNS,
  mailboxRoleOf,
  MailRefusedError,
  messageId as toMessageId,
  nativeMailboxId,
  roleMailboxId,
  threadId as toThreadId,
  threadVersion,
  type ConnectedMailAccount,
  type Mailbox,
  type MailboxColor,
  type MailboxId,
  type MailboxRole,
  type MailChanges,
  type MailProvider,
  type MailProviderDefinition,
  type MailPush,
  type MailQueryColumn,
  type MailWriteTarget,
  type MessageContent,
  type OutgoingMessage,
  type ThreadId,
  type ThreadSummaryResult,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import {
  _mailLocalAccounts,
  _mailLocalAttachments,
  _mailLocalChanges,
  _mailLocalMailboxes,
  _mailLocalMessages,
} from "./tables";

// The local provider: a MailProvider whose mail lives in this host's own
// database (the tables in ./tables.ts). It reaches no network and needs no
// computer, so it runs on every host — the website's demo serves its
// mailbox from the browser's PGlite. Its query language IS the contract's
// filter (the canonical filter JSON, `compileCanonicalMailQuery`), compiled
// to SQL by the filter language's own SQL half. Every write is ONE atomic
// statement that also appends to the change log, whose `seq` is the change
// cursor; the push is in-process — every write this process commits signals
// it — so it is always live.

/** The one account's id. */
export const LOCAL_ACCOUNT_ID = "local";

const NOT_CONNECTED = "No local mailbox on this device.";

/** The role mailboxes every local mailbox has, in the order a client lists them. */
const ROLES: readonly (readonly [MailboxRole, string])[] = [
  ["inbox", "Inbox"],
  ["sent", "Sent"],
  ["drafts", "Drafts"],
  ["trash", "Trash"],
  ["spam", "Spam"],
  ["important", "Important"],
];
const ROLE_IDS = new Set<string>(ROLES.map(([r]) => roleMailboxId(r)));

const INBOX = roleMailboxId("inbox");
const SENT = roleMailboxId("sent");
const DRAFTS = roleMailboxId("drafts");
const TRASH = roleMailboxId("trash");
const SPAM = roleMailboxId("spam");

/**
 * The label colours: Gmail's label palette (its eighteen pairs, as
 * `providers/gmail` offers them), so a mailbox written for one reads the
 * same on the other. Clearable.
 */
export const LOCAL_MAILBOX_COLORS: readonly MailboxColor[] = [
  ["#fb4c2f", "#ffffff"],
  ["#ffad47", "#ffffff"],
  ["#fad165", "#000000"],
  ["#16a766", "#ffffff"],
  ["#43d692", "#ffffff"],
  ["#4a86e8", "#ffffff"],
  ["#a479e2", "#ffffff"],
  ["#f691b3", "#ffffff"],
  ["#cc3a21", "#ffffff"],
  ["#eaa041", "#ffffff"],
  ["#f2c960", "#000000"],
  ["#149e60", "#ffffff"],
  ["#2da2bb", "#ffffff"],
  ["#3c78d8", "#ffffff"],
  ["#8e63ce", "#ffffff"],
  ["#e07798", "#ffffff"],
  ["#666666", "#ffffff"],
  ["#000000", "#ffffff"],
].map(([background, text]) =>
  Object.freeze({ background: background!, text: text! }),
);

/** At most this many change rows per `changesSince` answer (then `more`). */
const CHANGES_PAGE_MAX = 500;
const SNIPPET_MAX = 120;

/** An address and its display name (absent, null or blank: none). */
type DeliveredParticipant = { name?: string | null; address: string };

/** One message delivered into the mailbox (`deliver`): what arrived, as the account received it. */
export type LocalDelivery = {
  /** The thread it joins (a new one when no message holds this id yet). */
  threadId: string;
  id: string;
  date: Date;
  from: DeliveredParticipant;
  to: readonly DeliveredParticipant[];
  cc?: readonly DeliveredParticipant[];
  /** What the sender's own copy keeps (a delivery to someone else has none). */
  bcc?: readonly DeliveredParticipant[];
  replyTo?: readonly DeliveredParticipant[];
  subject: string;
  text?: string | null;
  html?: string | null;
  /** A body's declared charset when no decoder knew it (its content then read as UTF-8). */
  textUnknownCharset?: string | null;
  htmlUnknownCharset?: string | null;
  mailboxes: readonly MailboxId[];
  unread?: boolean;
  starred?: boolean;
  /** A draft in progress (its mailbox is Drafts): `findDraft` answers it. */
  isDraft?: boolean;
  /** The `Message-ID` header, angle brackets included. */
  rfc822MessageId: string;
  inReplyTo?: string | null;
  references?: readonly string[];
  attachments?: readonly {
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    contentId?: string | null;
    /** Shown in the body; default: it has a Content-ID. */
    inline?: boolean;
  }[];
};

const m = _mailLocalMessages;
const att = _mailLocalAttachments;
const changes = _mailLocalChanges;

/** A participant as a header writes it — `Name <a@b>`, or the bare address. */
const participantSql = (name: SQL, address: SQL) =>
  sql`(CASE WHEN ${name} IS NULL THEN ${address} ELSE ${name} || ' <' || ${address} || '>' END)`;

const fromSql = participantSql(sql`${m.fromName}`, sql`${m.fromAddress}`);

/** The `To` participants of the row, written as a header writes each, joined by `sep`. */
const toSql = (sep: string) =>
  sql`(SELECT string_agg(${participantSql(sql`(x.e->>'name')`, sql`(x.e->>'address')`)}, ${sep}::text ORDER BY x.o) FROM jsonb_array_elements(${m.to}) WITH ORDINALITY AS x(e, o))`;

/**
 * Each query column, as the SQL the filter language's ops run over — the
 * same text the in-memory fake matches (`from` / `to` as headers write them,
 * `query` the subject, sender, recipients and text), so the two answer alike.
 */
const QUERY_TARGETS: Readonly<Record<MailQueryColumn, SQL>> = {
  mailboxes: sql`${m.mailboxes}`,
  unread: sql`${m.unread}`,
  starred: sql`${m.starred}`,
  // A file the reader lists: an inline `cid:` image is part of the body.
  hasAttachment: sql`EXISTS (SELECT 1 FROM ${att} WHERE ${att.messageId} = ${m.id} AND NOT ${att.inline})`,
  date: sql`${m.date}`,
  from: fromSql,
  to: sql`coalesce(${toSql(", ")}, '')`,
  subject: sql`${m.subject}`,
  query: sql`concat_ws(E'\\n', ${m.subject}, ${fromSql}, ${toSql("\n")}, coalesce(${m.text}, ''))`,
};

/** The row's mailboxes with `add` joined and `remove` taken out — deduped, sorted. */
function boxesAfter(add: readonly string[], remove: readonly string[]): SQL {
  return sql`(SELECT coalesce(jsonb_agg(DISTINCT b ORDER BY b), '[]'::jsonb) FROM jsonb_array_elements_text(${m.mailboxes} || ${JSON.stringify(add)}::jsonb) AS b WHERE b NOT IN (SELECT jsonb_array_elements_text(${JSON.stringify(remove)}::jsonb)))`;
}

const cleanName = (p: { name?: string | null }) =>
  p.name === undefined || p.name === null || p.name.trim() === ""
    ? null
    : p.name;
const participants = (
  ps: readonly { name?: string | null; address: string }[],
) => ps.map((p) => ({ name: cleanName(p), address: p.address }));

function snippetOf(text: string | null, html: string | null): string {
  const plain =
    text ??
    (html ?? "")
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  return plain.replace(/\s+/g, " ").trim().slice(0, SNIPPET_MAX);
}

/** A list cursor: the last hit's date and id (the list's order). */
function encodeListCursor(date: Date, id: string) {
  return listCursor(`${date.toISOString()}|${id}`);
}
function decodeListCursor(c: string): { date: Date; id: string } {
  const bar = c.indexOf("|");
  const date = new Date(c.slice(0, bar));
  if (bar < 0 || Number.isNaN(date.getTime())) {
    throw new Error(`local mail: ${JSON.stringify(c)} is not a list cursor`);
  }
  return { date, id: c.slice(bar + 1) };
}

const CountRowSchema = z.object({
  mailbox: z.string(),
  threads: z.number(),
  unread: z.number(),
});

/**
 * The local provider over `db`: its definition (registered by the server
 * barrel over the app's database), and `deliver` / `setAccount`, the
 * inbound writes no user endpoint makes (mail arriving; the account set up).
 */
export function createLocalMail({ db }: { db: Db }) {
  const listeners = new Set<{ changed: () => void; state: () => void }>();
  const liveSince = new Date(wallNow("human-time")).toISOString();
  const push: MailPush = {
    state: () => ({ kind: "live", since: liveSince }),
    listen(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };

  /**
   * One write: `plan` reads what it needs on `tx` and answers the writes,
   * run as one statement, then the push is signalled. Every write of this
   * mailbox runs under ONE transaction-scoped advisory lock, taken first:
   *
   * - the change log's `seq` is an identity, assigned at insert; on a pooled
   *   Postgres two concurrent writers could commit out of `seq` order, and a
   *   reader between the two commits would move its cursor past the one not
   *   yet visible — skipping it for good. Holding the lock from before the
   *   insert until the commit makes commit order `seq` order, so `seq > cursor`
   *   never misses a row (`changesSince` needs no lock: it sees a prefix);
   * - what a write checks (a label exists, a name is free, the messages a
   *   label strips) cannot move under it before it commits.
   *
   * No flaw: a mailbox's writes are a person's clicks and a seed's deliveries,
   * so serializing them costs nothing measurable. PGlite serializes anyway.
   */
  async function commitReturning<T>(
    plan: (
      tx: DbExecutor,
    ) => Promise<{ writes: readonly AtomicWrite[]; value: T }>,
  ): Promise<T> {
    const value = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('mail_local_changes'))`,
      );
      const planned = await plan(tx);
      await writeAtomically(tx, planned.writes);
      return planned.value;
    });
    for (const l of listeners) l.changed();
    return value;
  }

  const commit = (
    plan: (tx: DbExecutor) => Promise<readonly AtomicWrite[]>,
  ): Promise<void> =>
    commitReturning(async (tx) => ({
      writes: await plan(tx),
      value: undefined,
    }));

  const logChanges = (
    threads: readonly string[],
    mailboxesChanged: boolean,
  ): AtomicWrite =>
    threads.length === 0
      ? null
      : db.insert(changes).values(
          [...new Set(threads)].map((threadId) => ({
            threadId,
            mailboxesChanged,
          })),
        );

  const logMailboxChange = (): AtomicWrite =>
    db.insert(changes).values({ threadId: null, mailboxesChanged: true });

  async function account(ex: DbExecutor = db) {
    const [row] = await ex
      .select()
      .from(_mailLocalAccounts)
      .where(eq(_mailLocalAccounts.id, LOCAL_ACCOUNT_ID));
    return row ?? null;
  }

  async function labelRows(ex: DbExecutor = db) {
    return ex.select().from(_mailLocalMailboxes);
  }

  /** Throws unless every id is a role this mailbox has or a label it holds (read on `ex`: under the lock, it stays so until the commit). */
  async function assertMailboxes(
    ex: DbExecutor,
    ids: readonly string[],
  ): Promise<void> {
    const known = new Set<string>(ROLE_IDS);
    for (const r of await labelRows(ex)) known.add(r.id);
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw new MailRefusedError(
        `local mail: no mailbox ${missing.join(", ")}`,
      );
    }
  }

  /** The message writes act on the targets' listed messages only. */
  async function writeMessages(
    targets: readonly MailWriteTarget[],
    set: Partial<{
      mailboxes: SQL;
      unread: boolean;
      starred: boolean;
    }>,
    mailboxesChanged: boolean,
    check: (tx: DbExecutor) => Promise<void> = async () => {},
  ): Promise<void> {
    const ids = targets.flatMap((t) => t.messages as readonly string[]);
    if (targets.length === 0) return;
    await commit(async (tx) => {
      await check(tx);
      return [
        ids.length === 0
          ? null
          : db.update(m).set(set).where(inArray(m.id, ids)),
        logChanges(
          targets.map((t) => t.thread),
          mailboxesChanged,
        ),
      ];
    });
  }

  /** The thread a message replying to `ids` (its In-Reply-To, then References, newest first) belongs to. */
  async function threadReplied(
    ex: DbExecutor,
    ids: readonly string[],
  ): Promise<ThreadId | null> {
    if (ids.length === 0) return null;
    const rows = await ex
      .select({ threadId: m.threadId, rfc: m.rfc822MessageId })
      .from(m)
      .where(inArray(m.rfc822MessageId, [...ids]));
    for (const id of ids) {
      const hit = rows.find((r) => r.rfc === id);
      if (hit) return toThreadId(hit.threadId);
    }
    return null;
  }

  const mint = (kind: string) => `${kind}-${crypto.randomUUID()}`;

  /** The inserts of one message and its attachments (`draftId`: the draft it is the current version of). */
  function insertMessage(
    d: LocalDelivery,
    draftId: string | null,
  ): AtomicWrite[] {
    return [
      db.insert(m).values({
        id: d.id,
        threadId: d.threadId,
        date: d.date,
        fromName: cleanName(d.from),
        fromAddress: d.from.address,
        to: participants(d.to),
        cc: participants(d.cc ?? []),
        bcc: participants(d.bcc ?? []),
        replyTo: participants(d.replyTo ?? []),
        subject: d.subject,
        text: d.text ?? null,
        textUnknownCharset: d.textUnknownCharset ?? null,
        html: d.html ?? null,
        htmlUnknownCharset: d.htmlUnknownCharset ?? null,
        mailboxes: [...new Set(d.mailboxes)].sort(),
        unread: d.unread ?? false,
        starred: d.starred ?? false,
        isDraft: d.isDraft ?? false,
        draftId,
        rfc822MessageId: d.rfc822MessageId,
        inReplyTo: d.inReplyTo ?? null,
        references: [...(d.references ?? [])],
      }),
      d.attachments === undefined || d.attachments.length === 0
        ? null
        : db.insert(att).values(
            d.attachments.map((a, i) => ({
              messageId: d.id,
              partId: String(i + 1),
              filename: a.filename,
              mimeType: a.mimeType,
              bytes: a.bytes,
              contentId: a.contentId ?? null,
              inline: a.inline ?? (a.contentId ?? null) !== null,
            })),
          ),
    ];
  }

  /**
   * An outgoing message's bytes as the delivery that stores it: its headers
   * and bodies parsed back, threaded under `threadId`, else by its
   * In-Reply-To / References, else a new thread.
   */
  async function outgoing(
    ex: DbExecutor,
    o: OutgoingMessage,
    extra: { mailboxes: MailboxId[]; isDraft: boolean; unread: boolean },
  ): Promise<LocalDelivery> {
    assertOutgoingMessageId(o);
    const p = parseMimeMessage(o.mime);
    const a = await account(ex);
    const from = p.from ?? {
      name: a?.displayName ?? null,
      address: a?.address ?? "",
    };
    if (from.address === "") {
      throw new Error("local mail: an outgoing message names no sender");
    }
    const thread =
      o.threadId ??
      (await threadReplied(
        ex,
        [p.inReplyTo, ...[...p.references].reverse()].filter(
          (x): x is string => x !== null,
        ),
      )) ??
      toThreadId(mint("thread"));
    return {
      threadId: thread,
      id: mint("msg"),
      date: new Date(wallNow("human-time")),
      from,
      to: p.to,
      cc: p.cc,
      bcc: p.bcc,
      replyTo: p.replyTo,
      subject: p.subject,
      text: p.text?.content ?? null,
      textUnknownCharset: p.text?.unknownCharset ?? null,
      html: p.html?.content ?? null,
      htmlUnknownCharset: p.html?.unknownCharset ?? null,
      mailboxes: extra.mailboxes,
      unread: extra.unread,
      isDraft: extra.isDraft,
      rfc822MessageId: o.rfc822MessageId,
      inReplyTo: p.inReplyTo,
      references: p.references,
      attachments: p.attachments.map((x) => ({
        filename: x.filename,
        mimeType: x.mimeType,
        bytes: x.bytes,
        contentId: x.contentId,
        inline: x.inline,
      })),
    };
  }

  async function mailboxRow(ex: DbExecutor, id: MailboxId) {
    const [row] = await ex
      .select()
      .from(_mailLocalMailboxes)
      .where(eq(_mailLocalMailboxes.id, id));
    if (!row) throw new MailRefusedError(`local mail: no label ${id}`);
    return row;
  }

  async function assertNameFree(
    ex: DbExecutor,
    name: string,
    parentId: string | null,
    except: string | null,
  ): Promise<void> {
    const taken = (await labelRows(ex)).some(
      (r) => r.parentId === parentId && r.name === name && r.id !== except,
    );
    if (taken) {
      throw new MailRefusedError(
        `local mail: a label named "${name}" is already there`,
      );
    }
  }

  const provider: MailProvider = {
    async listMessages(query, page) {
      const filter = decodeCanonicalMailQuery(query);
      const cursor =
        page.cursor === null ? null : decodeListCursor(page.cursor);
      const rows = await db
        .select({ id: m.id, threadId: m.threadId, date: m.date })
        .from(m)
        .where(
          and(
            filterSql(filter, QUERY_TARGETS, MAIL_QUERY_COLUMNS),
            page.olderThan === null ? undefined : lt(m.date, page.olderThan),
            cursor === null
              ? undefined
              : sql`(${m.date}, ${m.id}) < (${cursor.date.toISOString()}::timestamptz, ${cursor.id}::text)`,
          ),
        )
        .orderBy(desc(m.date), desc(m.id))
        .limit(page.limit + 1);
      const hits = rows.slice(0, page.limit);
      const last = hits[hits.length - 1];
      return {
        hits: hits.map((r) => ({
          thread: toThreadId(r.threadId),
          message: toMessageId(r.id),
        })),
        next:
          rows.length > page.limit && last !== undefined
            ? encodeListCursor(last.date, last.id)
            : null,
      };
    },

    async getThreads(ids) {
      if (ids.length === 0) return [];
      // The facts and the version from ONE snapshot: a write landing between
      // two reads would stamp the old facts with the new version, and a
      // cached summary at that version would pass for current.
      const { rows, versions } = await db.transaction(
        async (tx) => ({
          rows: await tx
            .select({
              id: m.id,
              threadId: m.threadId,
              date: m.date,
              fromName: m.fromName,
              fromAddress: m.fromAddress,
              to: m.to,
              subject: m.subject,
              text: m.text,
              html: m.html,
              mailboxes: m.mailboxes,
              unread: m.unread,
              starred: m.starred,
              isDraft: m.isDraft,
              hasAttachments: QUERY_TARGETS.hasAttachment.mapWith(Boolean),
            })
            .from(m)
            .where(inArray(m.threadId, [...ids]))
            .orderBy(asc(m.date), asc(m.id)),
          versions: await tx
            .select({ threadId: changes.threadId, seq: max(changes.seq) })
            .from(changes)
            .where(inArray(changes.threadId, [...ids]))
            .groupBy(changes.threadId),
        }),
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
      return ids.map((id): ThreadSummaryResult => {
        const ms = rows.filter((r) => r.threadId === id);
        if (ms.length === 0) return { id, kind: "gone" };
        const seq = versions.find((v) => v.threadId === id)?.seq;
        if (seq === undefined || seq === null) {
          throw new Error(`local mail: thread ${id} has no change logged`);
        }
        return {
          id,
          kind: "found",
          summary: deriveThreadSummary({
            id,
            version: threadVersion(String(seq)),
            messages: ms.map((r) => ({
              id: toMessageId(r.id),
              date: r.date,
              from: { name: r.fromName, address: r.fromAddress },
              to: r.to,
              subject: r.subject,
              snippet: snippetOf(r.text, r.html),
              mailboxes: r.mailboxes as MailboxId[],
              unread: r.unread,
              starred: r.starred,
              isDraft: r.isDraft,
              hasAttachments: r.hasAttachments,
            })),
          }),
        };
      });
    },

    async getThreadContent(id) {
      // The messages, their parts and the version from ONE snapshot (see getThreads).
      const read = await db.transaction(
        async (tx) => {
          const rows = await tx
            .select()
            .from(m)
            .where(eq(m.threadId, id))
            .orderBy(asc(m.date), asc(m.id));
          if (rows.length === 0) return null;
          const parts = await tx
            .select({
              messageId: att.messageId,
              partId: att.partId,
              filename: att.filename,
              mimeType: att.mimeType,
              contentId: att.contentId,
              inline: att.inline,
              size: sql`octet_length(${att.bytes})`.mapWith(Number),
            })
            .from(att)
            .where(
              inArray(
                att.messageId,
                rows.map((r) => r.id),
              ),
            )
            .orderBy(asc(att.messageId), asc(att.partId));
          const [version] = await tx
            .select({ seq: max(changes.seq) })
            .from(changes)
            .where(eq(changes.threadId, id));
          return { rows, parts, version };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
      if (read === null) return { kind: "gone" };
      const { rows, parts, version } = read;
      if (version?.seq === undefined || version.seq === null) {
        throw new Error(`local mail: thread ${id} has no change logged`);
      }
      return {
        kind: "found",
        content: {
          id,
          version: threadVersion(String(version.seq)),
          messages: rows.map((r): MessageContent => ({
            id: toMessageId(r.id),
            from: { name: r.fromName, address: r.fromAddress },
            to: r.to,
            cc: r.cc,
            bcc: r.bcc,
            replyTo: r.replyTo,
            subject: r.subject,
            date: r.date,
            rfc822MessageId: r.rfc822MessageId,
            inReplyTo: r.inReplyTo,
            references: r.references,
            mailboxes: [...r.mailboxes].sort() as MailboxId[],
            unread: r.unread,
            starred: r.starred,
            isDraft: r.isDraft,
            text:
              r.text === null
                ? null
                : { content: r.text, unknownCharset: r.textUnknownCharset },
            html:
              r.html === null
                ? null
                : { content: r.html, unknownCharset: r.htmlUnknownCharset },
            attachments: parts
              .filter((p) => p.messageId === r.id)
              .map((p) => ({
                ref: {
                  messageId: toMessageId(r.id),
                  partId: p.partId,
                  handle: p.partId,
                },
                filename: p.filename,
                mimeType: p.mimeType,
                size: p.size,
                contentId: p.contentId,
                inline: p.inline,
              })),
          })),
        },
      };
    },

    async getAttachment(ref) {
      const [row] = await db
        .select({ bytes: att.bytes })
        .from(att)
        .where(
          and(eq(att.messageId, ref.messageId), eq(att.partId, ref.handle)),
        );
      if (!row) {
        throw new Error(
          `local mail: no attachment ${ref.handle} on message ${ref.messageId}`,
        );
      }
      return row.bytes;
    },

    async listMailboxes() {
      const counts = await executeRows(db, {
        label: "local mail: mailbox counts",
        query: sql`SELECT b AS mailbox, count(DISTINCT ${m.threadId})::int AS threads, (count(DISTINCT ${m.threadId}) FILTER (WHERE ${m.unread}))::int AS unread FROM ${m}, jsonb_array_elements_text(${m.mailboxes}) AS b GROUP BY b`,
        row: CountRowSchema,
      });
      const countsOf = (id: string) => {
        const c = counts.find((x) => x.mailbox === id);
        return { threads: c?.threads ?? 0, unread: c?.unread ?? 0 };
      };
      const roles: Mailbox[] = ROLES.map(([role, name]) => ({
        id: roleMailboxId(role),
        name,
        role,
        kind: "system",
        parentId: null,
        counts: countsOf(roleMailboxId(role)),
        color: null,
      }));
      const labels: Mailbox[] = (await labelRows()).map((r) => ({
        id: nativeMailboxId(r.id),
        name: r.name,
        role: null,
        kind: "user",
        parentId: r.parentId === null ? null : nativeMailboxId(r.parentId),
        counts: countsOf(r.id),
        color: r.color,
      }));
      return [...roles, ...labels];
    },

    async findMessage(rfc) {
      const [row] = await db
        .select({ id: m.id, threadId: m.threadId })
        .from(m)
        .where(eq(m.rfc822MessageId, rfc))
        .limit(1);
      return row
        ? {
            kind: "found",
            messageId: toMessageId(row.id),
            threadId: toThreadId(row.threadId),
          }
        : { kind: "absent" };
    },

    async currentCursor() {
      const [row] = await db.select({ seq: max(changes.seq) }).from(changes);
      return changeCursor(String(row?.seq ?? 0));
    },

    async changesSince(cursor): Promise<MailChanges> {
      const since = Number(cursor);
      if (!Number.isSafeInteger(since) || since < 0) return { kind: "reset" };
      const [top] = await db.select({ seq: max(changes.seq) }).from(changes);
      // A cursor past the log's end names a log this mailbox no longer has.
      if (since > (top?.seq ?? 0)) return { kind: "reset" };
      const rows = await db
        .select()
        .from(changes)
        .where(sql`${changes.seq} > ${since}`)
        .orderBy(asc(changes.seq))
        .limit(CHANGES_PAGE_MAX + 1);
      const page = rows.slice(0, CHANGES_PAGE_MAX);
      const threads = [
        ...new Set(
          page.flatMap((r) => (r.threadId === null ? [] : [r.threadId])),
        ),
      ].map(toThreadId);
      return {
        kind: "changes",
        threads,
        mailboxes: page.some((r) => r.mailboxesChanged)
          ? "changed"
          : "unchanged",
        next: changeCursor(String(page[page.length - 1]?.seq ?? since)),
        more: rows.length > CHANGES_PAGE_MAX,
      };
    },

    archive: (targets) =>
      writeMessages(targets, { mailboxes: boxesAfter([], [INBOX]) }, true),
    moveToInbox: (targets) =>
      writeMessages(
        targets,
        { mailboxes: boxesAfter([INBOX], [TRASH, SPAM]) },
        true,
      ),
    trash: (targets) =>
      writeMessages(targets, { mailboxes: boxesAfter([TRASH], [INBOX]) }, true),
    untrash: (targets) =>
      writeMessages(targets, { mailboxes: boxesAfter([], [TRASH]) }, true),
    setFlags: (targets, flags) =>
      writeMessages(
        targets,
        {
          ...(flags.unread === undefined ? {} : { unread: flags.unread }),
          ...(flags.starred === undefined ? {} : { starred: flags.starred }),
        },
        // Unread counts move; a star moves none.
        flags.unread !== undefined,
      ),
    async setMailboxes(targets, change) {
      await writeMessages(
        targets,
        { mailboxes: boxesAfter(change.add, change.remove) },
        true,
        // Under the lock: a label deleted meanwhile is refused, never written.
        (tx) => assertMailboxes(tx, change.add),
      );
    },

    async createMailbox({ name, parentId }) {
      const clean = name.trim();
      if (clean === "") throw new MailRefusedError("a label needs a name");
      const id = nativeMailboxId(mint("label"));
      await commit(async (tx) => {
        if (parentId !== null) await mailboxRow(tx, parentId);
        await assertNameFree(tx, clean, parentId, null);
        return [
          db
            .insert(_mailLocalMailboxes)
            .values({ id, name: clean, parentId, color: null }),
          logMailboxChange(),
        ];
      });
      return {
        id,
        name: clean,
        role: null,
        kind: "user",
        parentId,
        counts: null,
        color: null,
      };
    },

    async renameMailbox(id, name) {
      const clean = name.trim();
      if (clean === "") throw new MailRefusedError("a label needs a name");
      await commit(async (tx) => {
        const row = await mailboxRow(tx, id);
        await assertNameFree(tx, clean, row.parentId, id);
        return [
          db
            .update(_mailLocalMailboxes)
            .set({ name: clean })
            .where(eq(_mailLocalMailboxes.id, id)),
          logMailboxChange(),
        ];
      });
    },

    async moveMailbox(id, parentId) {
      await commit(async (tx) => {
        const row = await mailboxRow(tx, id);
        const all = await labelRows(tx);
        for (
          let at: string | null = parentId;
          at !== null;
          at = all.find((r) => r.id === at)?.parentId ?? null
        ) {
          if (at === id) {
            throw new MailRefusedError(
              `local mail: a label cannot move under itself`,
            );
          }
        }
        if (parentId !== null) await mailboxRow(tx, parentId);
        await assertNameFree(tx, row.name, parentId, id);
        return [
          db
            .update(_mailLocalMailboxes)
            .set({ parentId })
            .where(eq(_mailLocalMailboxes.id, id)),
          logMailboxChange(),
        ];
      });
    },

    async setMailboxColor(id, color) {
      if (
        color !== null &&
        !LOCAL_MAILBOX_COLORS.some(
          (c) =>
            c.background === color.background.toLowerCase() &&
            c.text === color.text.toLowerCase(),
        )
      ) {
        throw new MailRefusedError(
          `local mail: ${color.background} on ${color.text} is not a label colour`,
        );
      }
      await commit(async (tx) => {
        await mailboxRow(tx, id);
        return [
          db
            .update(_mailLocalMailboxes)
            .set({ color })
            .where(eq(_mailLocalMailboxes.id, id)),
          logMailboxChange(),
        ];
      });
    },

    async deleteMailbox(id) {
      await commit(async (tx) => {
        const gone = await mailboxRow(tx, id);
        // Its sub-labels move up to its parent. A name already taken there is
        // refused, nothing written — as a rename or move onto a taken name is
        // (Gmail's flat names cannot hold two of one either): the user
        // renames one first.
        const all = await labelRows(tx);
        for (const child of all.filter((r) => r.parentId === id)) {
          if (
            all.some(
              (r) =>
                r.parentId === gone.parentId &&
                r.name === child.name &&
                r.id !== id,
            )
          ) {
            throw new MailRefusedError(
              `local mail: deleting "${gone.name}" would put two labels named "${child.name}" side by side — rename one first`,
            );
          }
        }
        // Under the lock: exactly these messages hold it until the commit.
        const holding = sql`${m.mailboxes} @> jsonb_build_array(${id}::text)`;
        const threads = await tx
          .selectDistinct({ threadId: m.threadId })
          .from(m)
          .where(holding);
        return [
          db
            .update(_mailLocalMailboxes)
            .set({ parentId: gone.parentId })
            .where(eq(_mailLocalMailboxes.parentId, id)),
          db.delete(_mailLocalMailboxes).where(eq(_mailLocalMailboxes.id, id)),
          threads.length === 0
            ? null
            : db
                .update(m)
                .set({ mailboxes: boxesAfter([], [id]) })
                .where(holding),
          logMailboxChange(),
          logChanges(
            threads.map((t) => t.threadId),
            true,
          ),
        ];
      });
    },

    async saveDraft(o, existing) {
      const draft = existing ?? toDraftId(mint("draft"));
      const saved = await commitReturning(async (tx) => {
        const prior =
          existing === null
            ? []
            : await tx
                .select({ id: m.id, threadId: m.threadId })
                .from(m)
                .where(eq(m.draftId, existing));
        const d = await outgoing(
          tx,
          {
            ...o,
            threadId:
              o.threadId ??
              (prior[0] === undefined ? null : toThreadId(prior[0].threadId)),
          },
          { mailboxes: [DRAFTS], isDraft: true, unread: false },
        );
        return {
          writes: [
            // A save replaces the draft's message; the draft id stays.
            existing === null
              ? null
              : db.delete(m).where(eq(m.draftId, existing)),
            ...insertMessage(d, draft),
            logChanges([d.threadId, ...prior.map((p) => p.threadId)], true),
          ],
          value: d,
        };
      });
      return {
        draftId: draft,
        messageId: toMessageId(saved.id),
        threadId: toThreadId(saved.threadId),
      };
    },

    async findDraft(id) {
      const [row] = await db
        .select({ draftId: m.draftId })
        .from(m)
        .where(and(eq(m.id, id), eq(m.isDraft, true), isNotNull(m.draftId)));
      return row?.draftId
        ? { kind: "found", draftId: toDraftId(row.draftId) }
        : { kind: "absent" };
    },

    async deleteDraft(id) {
      await commit(async (tx) => {
        const rows = await tx
          .select({ threadId: m.threadId })
          .from(m)
          .where(eq(m.draftId, id));
        // Already gone: a replay is harmless.
        return rows.length === 0
          ? []
          : [
              db.delete(m).where(eq(m.draftId, id)),
              logChanges(
                rows.map((r) => r.threadId),
                true,
              ),
            ];
      });
    },

    async send(o) {
      const sent = await commitReturning(async (tx) => {
        // A replay of a send that landed answers the message it stored.
        const [known] = await tx
          .select({ id: m.id, threadId: m.threadId })
          .from(m)
          .where(eq(m.rfc822MessageId, o.rfc822MessageId))
          .limit(1);
        if (known !== undefined) {
          return {
            writes: [],
            value: { messageId: known.id, threadId: known.threadId },
          };
        }
        const a = await account(tx);
        const p = parseMimeMessage(o.mime);
        // Never delivered anywhere: a message to the account's own address
        // also lands in its Inbox, as a mail client shows a note to self.
        const toSelf =
          a !== null &&
          [...p.to, ...p.cc, ...p.bcc].some(
            (r) => r.address.toLowerCase() === a.address.toLowerCase(),
          );
        const d = await outgoing(tx, o, {
          mailboxes: toSelf ? [SENT, INBOX] : [SENT],
          isDraft: false,
          unread: toSelf,
        });
        return {
          writes: [...insertMessage(d, null), logChanges([d.threadId], true)],
          value: { messageId: d.id, threadId: d.threadId as string },
        };
      });
      return {
        messageId: toMessageId(sent.messageId),
        threadId: toThreadId(sent.threadId),
      };
    },

    async sendIdentity(address) {
      const a = await account();
      return {
        address,
        displayName: a?.displayName ?? null,
        signature:
          a?.signature === null || a?.signature === undefined
            ? null
            : { text: a.signature },
      };
    },
  };

  const definition: MailProviderDefinition = {
    id: "local",
    label: "This device",
    capabilities: {
      mailboxModel: "labels",
      // Every label write is in the change log.
      mailboxDefinitions: "in-changes",
      // It lists and cuts by `date` itself.
      listOrderSlackMs: 0,
      mailboxColors: { palette: LOCAL_MAILBOX_COLORS, clearable: true },
    },
    push,
    compileQuery: (q, ctx) =>
      compileCanonicalMailQuery(q, ctx, { label: "the local mailbox" }),
    open(accountId) {
      if (accountId !== LOCAL_ACCOUNT_ID) {
        throw new Error(`local mail: no account ${accountId}`);
      }
      return provider;
    },
    async connectedAccount(): Promise<ConnectedMailAccount> {
      const a = await account();
      return a === null
        ? { kind: "not-connected", message: NOT_CONNECTED }
        : { kind: "connected", accountId: a.id, address: a.address };
    },
  };

  return {
    definition,
    provider,
    /** Mail arriving: one message, into its thread, its change logged and signalled. */
    async deliver(d: LocalDelivery): Promise<void> {
      if (mailboxRoleOfAll(d.mailboxes).includes("drafts") !== !!d.isDraft) {
        throw new Error(
          `local mail: message ${d.id} must be in Drafts exactly when it is a draft`,
        );
      }
      await commit(async (tx) => {
        await assertMailboxes(tx, d.mailboxes);
        return [
          ...insertMessage(d, d.isDraft ? mint("draft") : null),
          logChanges([d.threadId], true),
        ];
      });
    },
    /** Sets up (or changes) the one account: its address, display name and signature. */
    async setAccount(a: {
      address: string;
      displayName: string | null;
      signature: string | null;
    }): Promise<void> {
      await commit(async () => [
        db
          .insert(_mailLocalAccounts)
          .values({ id: LOCAL_ACCOUNT_ID, ...a })
          .onConflictDoUpdate({ target: _mailLocalAccounts.id, set: a }),
      ]);
    },
  };
}

function mailboxRoleOfAll(ids: readonly MailboxId[]): MailboxRole[] {
  return ids.flatMap((id) => {
    const role = mailboxRoleOf(id);
    return role === null ? [] : [role];
  });
}

export type LocalMail = ReturnType<typeof createLocalMail>;
