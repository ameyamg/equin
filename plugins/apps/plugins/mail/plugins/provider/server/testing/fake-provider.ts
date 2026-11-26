import {
  canonicalizeFilter,
  decodeFilter,
  encodeFilter,
  matchesFilter,
  type Filter,
} from "@plugins/network/plugins/live/plugins/filter/core";
import {
  assertOutgoingMessageId,
  changeCursor,
  draftId as toDraftId,
  isDeclaredMailOp,
  listCursor,
  MAIL_QUERY_COLUMNS,
  MailOutcomeUnknownError,
  messageId as toMessageId,
  nativeMailboxId,
  providerQuery,
  roleMailboxId,
  THREAD_PARTICIPANTS_MAX,
  threadId as toThreadId,
  threadVersion,
  type CompiledMailQuery,
  type Mailbox,
  type MailboxId,
  type MailCallOptions,
  type MailChanges,
  type MailProvider,
  type MailProviderDefinition,
  type MailPush,
  type MailQuery,
  type MessageContent,
  type OutgoingMessage,
  type Participant,
  type ThreadId,
  type ThreadSummary,
} from "../../core";
import type { DraftId, MessageId } from "../../core/internal/ids";
import type { MailQueryColumns } from "../../core/internal/query";

// An in-memory MailProvider for cache and e2e tests: a label-model mailbox
// (like Gmail) whose list, search, change cursor and writes behave as the
// contract says — message-level query semantics, newest first, a `before`
// cut per message, a cursor that can be expired into a reset, and send /
// create outcomes that can be made unknown. It records every call, so a test
// can count what a fill cost.

export type FakeAttachment = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  contentId?: string;
};

export type FakeMessageInput = {
  id?: string;
  date: Date | string;
  from: Participant;
  to?: Participant[];
  subject: string;
  text?: string;
  html?: string;
  mailboxes?: MailboxId[];
  unread?: boolean;
  starred?: boolean;
  isDraft?: boolean;
  attachments?: FakeAttachment[];
  rfc822MessageId?: string;
  /**
   * How far the provider's own clock (its list order and `olderThan` cut)
   * sits from `date`, in ms — Gmail's receipt time vs internalDate. Keep it
   * within the fake's `listOrderSlackMs`.
   */
  providerSkewMs?: number;
};

type FakeMessage = {
  id: MessageId;
  date: Date;
  from: Participant;
  to: Participant[];
  subject: string;
  text: string | null;
  html: string | null;
  mailboxes: Set<MailboxId>;
  unread: boolean;
  starred: boolean;
  isDraft: boolean;
  attachments: (FakeAttachment & { handle: string })[];
  rfc822MessageId: string;
  draftId: DraftId | null;
  providerSkewMs: number;
};

type FakeThread = { id: ThreadId; version: number; messages: FakeMessage[] };

export type FakeCall = { method: string; ids: number };

export type FakeMailProviderOptions = {
  /** Mailboxes besides the default roles (inbox, sent, drafts, trash, spam, important). */
  mailboxes?: Omit<Mailbox, "counts" | "color">[];
  threads?: { id?: string; messages: FakeMessageInput[] }[];
  /** At most this many changed threads per `changesSince` answer (then `more`). */
  changesPageMax?: number;
  /** The fake's declared `listOrderSlackMs` (default 0: it lists and cuts by `date`). */
  listOrderSlackMs?: number;
  /** The connected account (default `fake-account`, `fake@example.com`). */
  account?: { accountId: string; address: string };
  /** The provider's push (default none: the cache's fallback tick). */
  push?: MailPush;
};

const DEFAULT_ROLES = [
  ["inbox", "Inbox"],
  ["sent", "Sent"],
  ["drafts", "Drafts"],
  ["trash", "Trash"],
  ["spam", "Spam"],
  ["important", "Important"],
] as const;

const INBOX = roleMailboxId("inbox");
const TRASH = roleMailboxId("trash");
const SPAM = roleMailboxId("spam");
const SENT = roleMailboxId("sent");
const DRAFTS = roleMailboxId("drafts");

/** Every clause of a canonical filter, depth first. */
function clausesOf(f: Filter): Extract<Filter, { column: string }>[] {
  if ("and" in f) return f.and.flatMap(clausesOf);
  if ("or" in f) return f.or.flatMap(clausesOf);
  return [f];
}

/**
 * The fake's compile: the canonical filter JSON is its provider query. It
 * refuses what every provider must refuse (a pair outside MAIL_QUERY_OPS, a
 * mailbox the account does not have) and lets a test refuse more.
 */
export function fakeCompileQuery(
  query: MailQuery,
  ctx: { mailboxes: readonly Mailbox[] },
  refuse?: (clause: { column: string; op: string }) => boolean,
): CompiledMailQuery {
  const canonical = canonicalizeFilter(query, MAIL_QUERY_COLUMNS);
  if (canonical === undefined)
    return { kind: "query", providerQuery: providerQuery("") };
  if ("or" in canonical && canonical.or.length === 0)
    return { kind: "nothing" };
  const known = new Set(ctx.mailboxes.map((m) => m.id));
  for (const c of clausesOf(canonical as Filter)) {
    if (!isDeclaredMailOp(c.column, c.op) || refuse?.(c)) {
      return {
        kind: "refused",
        refusal: {
          column: c.column,
          op: c.op,
          reason: "unsupported-op",
          message: `the fake provider does not run ${c.column} ${c.op}`,
        },
      };
    }
    if (c.column === "mailboxes") {
      const missing = (c.operand as readonly string[]).find(
        (id) => !known.has(id as MailboxId),
      );
      if (missing !== undefined) {
        // A role this account has no mailbox for (Gmail's archive) is
        // unsupported, an id nobody listed is unknown — as a real provider says.
        const role = missing.startsWith("role:");
        return {
          kind: "refused",
          refusal: {
            column: c.column,
            op: c.op,
            reason: role ? "unsupported-mailbox" : "unknown-mailbox",
            message: `no mailbox ${missing}`,
          },
        };
      }
    }
  }
  return {
    kind: "query",
    providerQuery: providerQuery(encodeFilter(canonical, MAIL_QUERY_COLUMNS)!),
  };
}

const addr = (p: Participant) =>
  p.name ? `${p.name} <${p.address}>` : p.address;

function headerOf(mime: Uint8Array, name: string): string | null {
  const text = new TextDecoder().decode(mime);
  const end = text.search(/\r?\n\r?\n/);
  const head = end === -1 ? text : text.slice(0, end);
  const m = new RegExp(`^${name}:[ \\t]*(.*)$`, "im").exec(head);
  return m ? m[1]!.trim() : null;
}

export function createFakeMailProvider(opts: FakeMailProviderOptions = {}) {
  let clock = 1;
  /** Cursors older than this answer `reset`. */
  let historyFloor = 0;
  let nextId = 1;
  const mint = (p: string) => `${p}${nextId++}`;
  const log: { at: number; thread: ThreadId | null }[] = [];
  const threads = new Map<ThreadId, FakeThread>();
  const mailboxes = new Map<MailboxId, Omit<Mailbox, "counts" | "color">>();
  const calls: FakeCall[] = [];
  const failures = new Map<string, { error: Error; after: boolean }>();
  const changesPageMax = opts.changesPageMax ?? Number.POSITIVE_INFINITY;
  let connection:
    | { kind: "connected"; account: { accountId: string; address: string } }
    | { kind: "not-connected" | "unreachable"; message: string } = {
    kind: "connected",
    account: opts.account ?? {
      accountId: "fake-account",
      address: "fake@example.com",
    },
  };

  for (const [role, name] of DEFAULT_ROLES) {
    const id = roleMailboxId(role);
    mailboxes.set(id, { id, name, role, kind: "system", parentId: null });
  }
  for (const m of opts.mailboxes ?? []) mailboxes.set(m.id, m);

  function touch(thread: ThreadId | null) {
    clock++;
    if (thread) {
      const t = threads.get(thread);
      if (t) t.version = clock;
    }
    log.push({ at: clock, thread });
  }

  function toMessage(input: FakeMessageInput): FakeMessage {
    return {
      id: toMessageId(input.id ?? mint("m")),
      date: new Date(input.date),
      from: input.from,
      to: input.to ?? [],
      subject: input.subject,
      text: input.text ?? null,
      html: input.html ?? null,
      mailboxes: new Set(input.mailboxes ?? [INBOX]),
      unread: input.unread ?? false,
      starred: input.starred ?? false,
      isDraft: input.isDraft ?? false,
      attachments: (input.attachments ?? []).map((a) => ({
        ...a,
        handle: mint("att"),
      })),
      rfc822MessageId: input.rfc822MessageId ?? `<${mint("rfc")}@fake>`,
      draftId: null,
      providerSkewMs: input.providerSkewMs ?? 0,
    };
  }

  /** Adds a message to a thread (a new one when `thread` is null); records the change. */
  function deliver(thread: string | null, input: FakeMessageInput) {
    const id = toThreadId(thread ?? mint("t"));
    let t = threads.get(id);
    if (!t) {
      t = { id, version: clock, messages: [] };
      threads.set(id, t);
    }
    const m = toMessage(input);
    t.messages.push(m);
    t.messages.sort((a, b) => a.date.getTime() - b.date.getTime());
    touch(id);
    return { threadId: id, messageId: m.id };
  }

  for (const t of opts.threads ?? []) {
    const id = t.id ?? null;
    let at: string | null = id;
    for (const m of t.messages) at = deliver(at, m).threadId;
  }

  function row(m: FakeMessage) {
    return {
      mailboxes: [...m.mailboxes],
      unread: m.unread,
      starred: m.starred,
      hasAttachment: m.attachments.length > 0,
      date: m.date,
      from: addr(m.from),
      to: m.to.map(addr).join(", "),
      subject: m.subject,
      query: [m.subject, addr(m.from), ...m.to.map(addr), m.text ?? ""].join(
        "\n",
      ),
    };
  }

  const lastAt = (t: FakeThread) => {
    const sent = t.messages.filter((m) => !m.isDraft);
    const from = sent.length > 0 ? sent : t.messages;
    return from[from.length - 1]!.date;
  };

  function summary(t: FakeThread): ThreadSummary {
    const participants: Participant[] = [];
    for (const m of t.messages) {
      if (participants.length >= THREAD_PARTICIPANTS_MAX) break;
      if (!participants.some((p) => p.address === m.from.address))
        participants.push(m.from);
    }
    const recipients: Participant[] = [];
    for (const m of t.messages)
      for (const r of m.to)
        if (
          recipients.length < THREAD_PARTICIPANTS_MAX &&
          !recipients.some((x) => x.address === r.address)
        )
          recipients.push(r);
    const boxes = new Set<MailboxId>();
    for (const m of t.messages) for (const b of m.mailboxes) boxes.add(b);
    const last = t.messages[t.messages.length - 1]!;
    return {
      id: t.id,
      version: threadVersion(String(t.version)),
      subject: t.messages[0]!.subject,
      snippet: (last.text ?? "").slice(0, 120),
      participants,
      recipients,
      lastMessageAt: lastAt(t),
      messageCount: t.messages.length,
      mailboxes: [...boxes].sort(),
      unread: t.messages.some((m) => m.unread),
      starred: t.messages.some((m) => m.starred),
      hasAttachments: t.messages.some((m) => m.attachments.length > 0),
      hasDraft: t.messages.some((m) => m.isDraft),
      messages: t.messages.map((m) => ({
        id: m.id,
        date: m.date,
        mailboxes: [...m.mailboxes].sort(),
        unread: m.unread,
        starred: m.starred,
        isDraft: m.isDraft,
      })),
    };
  }

  function content(m: FakeMessage): MessageContent {
    return {
      id: m.id,
      from: m.from,
      to: m.to,
      cc: [],
      bcc: [],
      replyTo: [],
      subject: m.subject,
      date: m.date,
      rfc822MessageId: m.rfc822MessageId,
      inReplyTo: null,
      references: [],
      mailboxes: [...m.mailboxes].sort(),
      unread: m.unread,
      starred: m.starred,
      isDraft: m.isDraft,
      text: m.text === null ? null : { content: m.text, unknownCharset: null },
      html: m.html === null ? null : { content: m.html, unknownCharset: null },
      attachments: m.attachments.map((a, i) => ({
        ref: { messageId: m.id, partId: String(i + 1), handle: a.handle },
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.bytes.byteLength,
        contentId: a.contentId ?? null,
        inline: a.contentId !== undefined,
      })),
    };
  }

  async function call<T>(
    method: string,
    ids: number,
    o: MailCallOptions | undefined,
    run: () => T,
  ): Promise<T> {
    o?.signal?.throwIfAborted();
    calls.push({ method, ids });
    const fail = failures.get(method);
    if (fail) {
      failures.delete(method);
      if (fail.after) run();
      throw fail.error;
    }
    return run();
  }

  function eachThread(ids: readonly ThreadId[], fn: (t: FakeThread) => void) {
    for (const id of ids) {
      const t = threads.get(id);
      if (!t) throw new Error(`fake mail: no thread ${id}`);
      fn(t);
      touch(id);
    }
  }

  const findRfc = (rfc: string) => {
    for (const t of threads.values())
      for (const m of t.messages)
        if (m.rfc822MessageId === rfc) return { t, m };
    return null;
  };

  function store(m: OutgoingMessage, draft: boolean, existing: DraftId | null) {
    assertOutgoingMessageId(m);
    const subject = headerOf(m.mime, "Subject") ?? "";
    const from = headerOf(m.mime, "From") ?? "me@fake";
    const text = new TextDecoder().decode(m.mime).split(/\r?\n\r?\n/)[1] ?? "";
    if (existing) {
      for (const t of threads.values()) {
        t.messages = t.messages.filter((x) => x.draftId !== existing);
      }
    }
    const { threadId, messageId } = deliver(m.threadId, {
      date: new Date(clock * 1000),
      from: { name: null, address: from },
      subject,
      text,
      mailboxes: [draft ? DRAFTS : SENT],
      isDraft: draft,
      rfc822MessageId: m.rfc822MessageId,
    });
    const msg = threads
      .get(threadId)!
      .messages.find((x) => x.id === messageId)!;
    if (draft) msg.draftId = existing ?? toDraftId(mint("d"));
    return { threadId, messageId, draftId: msg.draftId };
  }

  const provider: MailProvider = {
    listMessages: (query, page, o) =>
      call("listMessages", 0, o, () => {
        const filter =
          query === "" ? undefined : decodeFilter(query, MAIL_QUERY_COLUMNS);
        const providerAt = (m: FakeMessage) =>
          m.date.getTime() + m.providerSkewMs;
        const cut = page.olderThan === null ? null : page.olderThan.getTime();
        const hits = [...threads.values()]
          .flatMap((t) => t.messages.map((m) => ({ t, m })))
          .filter(
            ({ m }) =>
              (cut === null || providerAt(m) < cut) &&
              (filter === undefined ||
                matchesFilter(
                  row(m),
                  filter as Filter<MailQueryColumns>,
                  MAIL_QUERY_COLUMNS,
                )),
          )
          .sort(
            (a, b) =>
              providerAt(b.m) - providerAt(a.m) || (a.m.id < b.m.id ? 1 : -1),
          );
        const offset = page.cursor === null ? 0 : Number(page.cursor);
        const slice = hits.slice(offset, offset + page.limit);
        return {
          hits: slice.map(({ t, m }) => ({ thread: t.id, message: m.id })),
          next:
            offset + page.limit < hits.length
              ? listCursor(String(offset + page.limit))
              : null,
        };
      }),
    getThreads: (ids, o) =>
      call("getThreads", ids.length, o, () =>
        ids.map((id) => {
          const t = threads.get(id);
          return t
            ? { id, kind: "found" as const, summary: summary(t) }
            : { id, kind: "gone" as const };
        }),
      ),
    getThreadContent: (id, o) =>
      call("getThreadContent", 1, o, () => {
        const t = threads.get(id);
        if (!t) return { kind: "gone" as const };
        return {
          kind: "found" as const,
          content: {
            id,
            version: threadVersion(String(t.version)),
            messages: t.messages.map(content),
          },
        };
      }),
    getAttachment: (ref, o) =>
      call("getAttachment", 1, o, () => {
        for (const t of threads.values())
          for (const m of t.messages)
            for (const a of m.attachments)
              if (m.id === ref.messageId && a.handle === ref.handle)
                return a.bytes;
        throw new Error(`fake mail: no attachment ${ref.handle}`);
      }),
    listMailboxes: (o) =>
      call("listMailboxes", 0, o, () =>
        [...mailboxes.values()].map((mb) => {
          const inBox = [...threads.values()].filter((t) =>
            t.messages.some((m) => m.mailboxes.has(mb.id)),
          );
          return {
            ...mb,
            counts: {
              threads: inBox.length,
              unread: inBox.filter((t) => t.messages.some((m) => m.unread))
                .length,
            },
            color: null,
          };
        }),
      ),
    findMessage: (rfc, o) =>
      call("findMessage", 0, o, () => {
        const hit = findRfc(rfc);
        return hit
          ? { kind: "found" as const, messageId: hit.m.id, threadId: hit.t.id }
          : { kind: "absent" as const };
      }),
    currentCursor: (o) =>
      call("currentCursor", 0, o, () => changeCursor(String(clock))),
    changesSince: (cursor, o) =>
      call("changesSince", 0, o, (): MailChanges => {
        const since = Number(cursor);
        if (!Number.isInteger(since) || since < historyFloor)
          return { kind: "reset" };
        const after = log.filter((e) => e.at > since);
        const changed: ThreadId[] = [];
        let upTo = clock;
        for (const e of after) {
          if (e.thread && !changed.includes(e.thread)) {
            if (changed.length >= changesPageMax) {
              upTo = e.at - 1;
              break;
            }
            changed.push(e.thread);
          }
        }
        return {
          kind: "changes",
          threads: changed,
          mailboxes: after.some((e) => e.at <= upTo) ? "changed" : "unchanged",
          next: changeCursor(String(upTo)),
          more: upTo < clock,
        };
      }),
    archive: (ids, o) =>
      call("archive", ids.length, o, () =>
        eachThread(ids, (t) =>
          t.messages.forEach((m) => m.mailboxes.delete(INBOX)),
        ),
      ),
    moveToInbox: (ids, o) =>
      call("moveToInbox", ids.length, o, () =>
        eachThread(ids, (t) =>
          t.messages.forEach((m) => {
            m.mailboxes.delete(TRASH);
            m.mailboxes.delete(SPAM);
            m.mailboxes.add(INBOX);
          }),
        ),
      ),
    trash: (ids, o) =>
      call("trash", ids.length, o, () =>
        eachThread(ids, (t) =>
          t.messages.forEach((m) => {
            m.mailboxes.delete(INBOX);
            m.mailboxes.add(TRASH);
          }),
        ),
      ),
    untrash: (ids, o) =>
      call("untrash", ids.length, o, () =>
        eachThread(ids, (t) =>
          t.messages.forEach((m) => m.mailboxes.delete(TRASH)),
        ),
      ),
    deleteForever: (ids, o) =>
      call("deleteForever", ids.length, o, () => {
        for (const id of ids) {
          threads.delete(id);
          touch(id);
        }
      }),
    setFlags: (ids, flags, o) =>
      call("setFlags", ids.length, o, () =>
        eachThread(ids, (t) =>
          t.messages.forEach((m) => {
            if (flags.unread !== undefined) m.unread = flags.unread;
            if (flags.starred !== undefined) m.starred = flags.starred;
          }),
        ),
      ),
    setMailboxes: (ids, change, o) =>
      call("setMailboxes", ids.length, o, () =>
        eachThread(ids, (t) =>
          t.messages.forEach((m) => {
            for (const b of change.remove) m.mailboxes.delete(b);
            for (const b of change.add) {
              if (!mailboxes.has(b))
                throw new Error(`fake mail: no mailbox ${b}`);
              m.mailboxes.add(b);
            }
          }),
        ),
      ),
    createMailbox: (m, o) =>
      call("createMailbox", 0, o, () => {
        const id = nativeMailboxId(mint("Label_"));
        const mb = {
          id,
          name: m.name,
          role: null,
          kind: "user" as const,
          parentId: m.parentId,
        };
        mailboxes.set(id, mb);
        touch(null);
        return { ...mb, counts: null, color: null };
      }),
    renameMailbox: (id, name, o) =>
      call("renameMailbox", 0, o, () => {
        const mb = mailboxes.get(id);
        if (!mb) throw new Error(`fake mail: no mailbox ${id}`);
        mailboxes.set(id, { ...mb, name });
        touch(null);
      }),
    deleteMailbox: (id, o) =>
      call("deleteMailbox", 0, o, () => {
        mailboxes.delete(id);
        for (const t of threads.values())
          for (const m of t.messages) m.mailboxes.delete(id);
        touch(null);
      }),
    saveDraft: (m, existing, o) =>
      call("saveDraft", 0, o, () => {
        const r = store(m, true, existing);
        return {
          draftId: r.draftId!,
          messageId: r.messageId,
          threadId: r.threadId,
        };
      }),
    deleteDraft: (id, o) =>
      call("deleteDraft", 0, o, () => {
        for (const t of threads.values()) {
          const before = t.messages.length;
          t.messages = t.messages.filter((x) => x.draftId !== id);
          if (t.messages.length !== before) touch(t.id);
          if (t.messages.length === 0) threads.delete(t.id);
        }
      }),
    send: (m, o) =>
      call("send", 0, o, () => {
        const r = store(m, false, null);
        return { messageId: r.messageId, threadId: r.threadId };
      }),
  };

  const definition: MailProviderDefinition = {
    id: "fake",
    label: "Fake mail",
    capabilities: {
      mailboxModel: "labels",
      mailboxDefinitions: "in-changes",
      listOrderSlackMs: opts.listOrderSlackMs ?? 0,
    },
    push: opts.push ?? null,
    compileQuery: (q, ctx) => fakeCompileQuery(q, ctx),
    open: () => provider,
    connectedAccount: () => {
      return Promise.resolve(
        connection.kind === "connected"
          ? { kind: "connected" as const, ...connection.account }
          : connection,
      );
    },
  };

  return {
    definition,
    provider,
    /** Every call made, in order: the method and how many thread ids it carried. */
    calls,
    deliver,
    /** Every cursor minted up to now answers `reset` from here on (Gmail's 404). */
    expireHistory() {
      historyFloor = clock + 1;
      touch(null);
    },
    /**
     * The next call of `method` throws `error` — before doing anything, or
     * after doing it (`after: true`: the send that landed though the answer
     * was lost).
     */
    failNext(
      method: keyof MailProvider,
      error: Error,
      o: { after?: boolean } = {},
    ) {
      failures.set(method, { error, after: o.after ?? false });
    },
    /**
     * Disconnects the account (`connectedAccount` answers not-connected),
     * makes the connection uncheckable (`"unreachable"`: offline), or
     * reconnects it.
     */
    setConnected(connected: boolean | "unreachable") {
      connection =
        connected === true
          ? {
              kind: "connected",
              account: opts.account ?? {
                accountId: "fake-account",
                address: "fake@example.com",
              },
            }
          : connected === "unreachable"
            ? { kind: "unreachable", message: "the fake connection is offline" }
            : {
                kind: "not-connected",
                message: "the fake account is disconnected",
              };
    },
    /** A lost answer on a send / create, as a provider reports it. */
    outcomeUnknown: (what: string) =>
      new MailOutcomeUnknownError(what, new Error("connection reset")),
  };
}

export type FakeMailProvider = ReturnType<typeof createFakeMailProvider>;
