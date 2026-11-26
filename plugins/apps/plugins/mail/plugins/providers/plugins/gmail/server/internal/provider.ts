import {
  GmailApiError,
  GmailOutcomeUnknownError,
  GmailUnreachableError,
  type GmailLabel,
} from "@plugins/integrations/plugins/gmail/plugins/api/core";
import type {
  GmailCallOptions,
  GmailClient,
} from "@plugins/integrations/plugins/gmail/plugins/api/server";
import {
  assertOutgoingMessageId,
  changeCursor,
  draftId,
  listCursor,
  MailNotConnectedError,
  MailOutcomeUnknownError,
  MailRefusedError,
  MailUnreachableError,
  messageId,
  threadId,
  type DraftId,
  type Mailbox,
  type MailboxId,
  type MailCallOptions,
  type MailChanges,
  type MailProvider,
  type MailWriteTarget,
  type OutgoingMessage,
  type ThreadId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import { withCut } from "./compile-query";
import { contentOfThread, inlinePartBytes, inlinePartOf } from "./content";
import {
  FLAG_LABELS,
  GMAIL_ROLE_LABELS,
  gmailLabelName,
  isGmailLabelColor,
  labelIdOfMailbox,
  mailboxesOfGmailLabels,
} from "./labels";
import { SUMMARY_HEADERS, summaryOfThread } from "./summary";

/** Where the next `changesSince` starts after a capped read: past the last record, never the same cursor (a caller would loop). */
function resumeAfter(lastRecord: string | null): string {
  if (lastRecord === null) {
    throw new Error(
      `Gmail answered ${HISTORY_PAGES_PER_CALL} history pages with no record and more to come: no cursor to resume from`,
    );
  }
  return lastRecord;
}

/** At most this many history pages per `changesSince` answer (500 records each); then `more`. */
export const HISTORY_PAGES_PER_CALL = 10;

/** `messages.batchModify`'s bound: message ids a call. */
const BATCH_MODIFY_MAX = 1000;

const INBOX = GMAIL_ROLE_LABELS.inbox.labelId;
const TRASH = GMAIL_ROLE_LABELS.trash.labelId;
const SPAM = GMAIL_ROLE_LABELS.spam.labelId;

/** Google's refusals that mean the grant, not the request, is the problem. */
function notConnected(err: GmailApiError): MailNotConnectedError | null {
  if (err.status === 401) {
    return new MailNotConnectedError(
      `Gmail refused the account's access (${err.detail})`,
      true,
    );
  }
  if (
    err.status === 403 &&
    (err.reason === "insufficientPermissions" ||
      err.reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT")
  ) {
    return new MailNotConnectedError(
      `Gmail access lacks a permission (${err.detail})`,
      true,
    );
  }
  return null;
}

/**
 * A write Gmail refused as asked (a 4xx that is not about access, a missing
 * object or rate): nothing was written, and doing it again fails the same way.
 */
function asRefused(err: unknown): unknown {
  if (
    err instanceof GmailApiError &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 404 &&
    err.status !== 429 &&
    notConnected(err) === null
  ) {
    return new MailRefusedError(`Gmail refused it: ${err.detail}`);
  }
  return err;
}

/** Gmail's failures in the contract's words; anything else is thrown as is. */
async function neutral<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof GmailUnreachableError)
      throw new MailUnreachableError(what, err);
    if (err instanceof GmailApiError) throw notConnected(err) ?? err;
    throw err;
  }
}

const gmailOpts = (o?: MailCallOptions): GmailCallOptions => ({
  priority: o?.priority,
  signal: o?.signal,
});

/** Gmail's `rfc822msgid:` term for a Message-ID (it takes the id without angle brackets). */
function rfc822Term(id: string): string {
  const bare = id.trim().replace(/^<|>$/g, "");
  if (bare === "" || /[\s"]/.test(bare)) {
    throw new Error(
      `mail: ${JSON.stringify(id)} is not a Message-ID Gmail can search`,
    );
  }
  return `rfc822msgid:${bare}`;
}

/**
 * Gmail gives a message sent or saved as a draft through the API a
 * Message-ID of its own: the bytes' is gone, so `rfc822msgid:` never finds
 * it (measured 2026-11-26 on the real account, `api/scripts/headers-probe.ts`
 * for a send; a draft probed the same way). It keeps every other header, so
 * a send or draft carries its Message-ID a second time in this one, and
 * `findMessage` reads it back off the account's recent Sent and Drafts.
 */
const SENT_ID_HEADER = "X-Equin-Message-Id";
/** How many recent Sent / Drafts messages a lookup reads (metadata, 5 units each). */
const SENT_LOOKUP_MAX = 25;
/** Where a message this account sent or saved lately is. */
const OWN_RECENT_QUERY = "(in:sent OR in:drafts) newer_than:2d";

/** The bytes with the sent-id header first (a header's place in the block does not matter). */
function withSentIdHeader(
  mime: Uint8Array,
  rfc822MessageId: string,
): Uint8Array {
  rfc822Term(rfc822MessageId); // a Message-ID with no space or line break
  const line = new TextEncoder().encode(
    `${SENT_ID_HEADER}: ${rfc822MessageId}\r\n`,
  );
  const out = new Uint8Array(line.length + mime.length);
  out.set(line);
  out.set(mime, line.length);
  return out;
}

/** How many `drafts.list` pages `findDraft` reads (100 drafts each) before it gives up loudly. */
const DRAFT_PAGES_MAX = 50;

const isNotFound = (err: unknown) =>
  err instanceof GmailApiError && err.status === 404;

/**
 * The contract over one account's Gmail client. Stateless: the client holds
 * the account's pacer; the definition holds the one client per account.
 */
export function createGmailMailProvider(client: GmailClient): MailProvider {
  /**
   * One label change on every target's messages: `messages.batchModify`, up
   * to 1,000 messages a call (50 units — a per-thread `threads.modify` costs
   * 10 a thread). Chunks run one after another, each idempotent (it sets
   * labels, so a replay is harmless).
   */
  async function modifyMessages(
    targets: readonly MailWriteTarget[],
    change: { addLabelIds?: string[]; removeLabelIds?: string[] },
    o: MailCallOptions | undefined,
  ): Promise<void> {
    const ids = targets.flatMap((t) => t.messages);
    for (let i = 0; i < ids.length; i += BATCH_MODIFY_MAX) {
      await client.batchModifyMessages(
        ids.slice(i, i + BATCH_MODIFY_MAX),
        change,
        gmailOpts(o),
      );
    }
  }

  /**
   * Settles a write whose outcome Google left unknown by looking for its
   * effect. A failing lookup (most often the same dropped connection) leaves
   * the outcome unknown: it never reads as "unreachable", which a caller
   * could take for "nothing happened" and do the write again.
   */
  async function reconcile<T>(
    what: string,
    cause: unknown,
    lookup: () => Promise<T | null>,
  ): Promise<T> {
    let found: T | null;
    try {
      found = await lookup();
    } catch (err) {
      throw new MailOutcomeUnknownError(
        what,
        new AggregateError([cause, err], `${what}: the lookup failed too`),
      );
    }
    if (found === null) throw new MailOutcomeUnknownError(what, cause);
    return found;
  }

  /** A listing's user label by mailbox id, with the tree the mailbox model reads; a system or missing one is refused. */
  function userLabelIn(
    labels: readonly GmailLabel[],
    id: MailboxId,
  ): { label: GmailLabel; mailbox: Mailbox; byId: Map<MailboxId, Mailbox> } {
    const native = labelIdOfMailbox(id);
    const label = labels.find((l) => l.id === native);
    if (!label) throw new MailRefusedError(`Gmail has no label ${native}`);
    if (label.type === "system") {
      throw new MailRefusedError(
        `Gmail's ${label.name} cannot be renamed, moved or deleted`,
      );
    }
    const mailboxes = mailboxesOfGmailLabels(labels);
    const byId = new Map(mailboxes.map((m) => [m.id, m]));
    const mailbox = byId.get(id);
    if (!mailbox)
      throw new Error(`mail: Gmail label ${native} is not a mailbox`);
    return { label, mailbox, byId };
  }

  /**
   * The full-name prefix of a mailbox's children-to-be under `parentId`:
   * the parent's full Gmail name and "/", or "" for a root. Read from the
   * mailbox model, never by cutting a name at its last "/": a root may hold
   * "/" in its own name (Gmail lists "a/b" with no "a" as a root named so).
   */
  function prefixUnder(
    parentId: MailboxId | null,
    byId: ReadonlyMap<MailboxId, Mailbox>,
  ): string {
    if (parentId === null) return "";
    const parent = byId.get(parentId);
    const full = parent ? gmailLabelName(parent, byId) : null;
    if (full === null) {
      throw new MailRefusedError(
        `Gmail has no label ${parentId} to nest under`,
      );
    }
    return `${full}/`;
  }

  /**
   * Renames labels to new full names, each label under one renamed with it
   * (Gmail nests by name, so a label left with the old prefix would stay
   * under the old name). Every new name is checked against the listing first
   * — Gmail's names are unique regardless of case — so a clash refuses before
   * anything is written; then one labels.patch each.
   */
  async function renameLabels(
    labels: readonly GmailLabel[],
    renames: readonly { label: GmailLabel; to: string }[],
    o: MailCallOptions | undefined,
  ): Promise<void> {
    const plan = new Map<string, string>();
    for (const { label, to } of renames) {
      if (to === label.name) continue;
      plan.set(label.id, to);
      for (const l of labels) {
        if (l.type === "user" && l.name.startsWith(`${label.name}/`)) {
          plan.set(l.id, `${to}${l.name.slice(label.name.length)}`);
        }
      }
    }
    const kept = new Set(
      labels.filter((l) => !plan.has(l.id)).map((l) => l.name.toLowerCase()),
    );
    const taking = new Set<string>();
    for (const to of plan.values()) {
      const key = to.toLowerCase();
      if (kept.has(key) || taking.has(key)) {
        throw new MailRefusedError(`a Gmail label is already named “${to}”`);
      }
      taking.add(key);
    }
    for (const [id, to] of plan) {
      await client.patchLabel(id, { name: to }, gmailOpts(o));
    }
  }

  /** The mailbox label `id` is, read among `labels` (its parent is found by name). */
  function mailboxOfLabel(labels: readonly GmailLabel[], id: string): Mailbox {
    const mine = mailboxesOfGmailLabels(labels).find((x) => x.id === id);
    if (!mine) throw new Error(`mail: Gmail label ${id} is not a mailbox`);
    return mine;
  }

  /** The draft whose message `id` is: drafts.list paged (a person's drafts are few; 100 a page, 5 units). */
  async function draftOfMessage(
    id: string,
    o?: MailCallOptions,
  ): Promise<DraftId | null> {
    let pageToken: string | undefined;
    for (let page = 0; page < DRAFT_PAGES_MAX; page++) {
      const r = await client.listDrafts(
        { maxResults: 100, pageToken },
        gmailOpts(o),
      );
      const hit = r.drafts.find((d) => d.message.id === id);
      if (hit) return draftId(hit.id);
      if (r.nextPageToken === null) return null;
      pageToken = r.nextPageToken;
    }
    throw new Error(
      `mail: more than ${DRAFT_PAGES_MAX * 100} Gmail drafts; the draft of message ${id} was not among them`,
    );
  }

  async function findMessage(rfc: string, o?: MailCallOptions) {
    const r = await client.listMessages(
      { q: rfc822Term(rfc), includeSpamTrash: true, maxResults: 1 },
      gmailOpts(o),
    );
    const hit = r.messages?.[0];
    if (hit) {
      return {
        kind: "found" as const,
        messageId: messageId(hit.id),
        threadId: threadId(hit.threadId),
      };
    }
    // Sent or saved from here: Gmail renamed it, and the name it had is in
    // SENT_ID_HEADER on one of the account's latest Sent or Drafts messages.
    const recent = await client.listMessages(
      { q: OWN_RECENT_QUERY, maxResults: SENT_LOOKUP_MAX },
      gmailOpts(o),
    );
    const refs = recent.messages ?? [];
    if (refs.length === 0) return { kind: "absent" as const };
    const metas = await client.getMessages(
      refs.map((m) => m.id),
      { format: "metadata", metadataHeaders: [SENT_ID_HEADER] },
      gmailOpts(o),
    );
    for (const [i, m] of metas.entries()) {
      // A part that failed leaves the answer unknown: never "absent".
      if (!m.ok) throw m.error;
      const header = m.value.payload?.headers?.find(
        (h) => h.name.toLowerCase() === SENT_ID_HEADER.toLowerCase(),
      );
      if (header?.value.trim() === rfc.trim()) {
        return {
          kind: "found" as const,
          messageId: messageId(refs[i]!.id),
          threadId: threadId(refs[i]!.threadId),
        };
      }
    }
    return { kind: "absent" as const };
  }

  return {
    listMessages: (query, page, o) =>
      neutral("messages.list", async () => {
        // messages.list, not threads.list: Gmail orders threads.list by a
        // thread's FIRST message (measured), messages.list by each message's
        // date — the order a date-sorted thread list pages in.
        const r = await client.listMessages(
          {
            q: withCut(query, page.olderThan) || undefined,
            maxResults: Math.min(page.limit, 500),
            pageToken: page.cursor ?? undefined,
            includeSpamTrash: true,
          },
          gmailOpts(o),
        );
        return {
          hits: (r.messages ?? []).map((m) => ({
            thread: threadId(m.threadId),
            message: messageId(m.id),
          })),
          next: r.nextPageToken ? listCursor(r.nextPageToken) : null,
        };
      }),

    getThreads: (ids, o) =>
      neutral("threads.get", async () => {
        const results = await client.getThreads(
          ids,
          { format: "metadata", metadataHeaders: SUMMARY_HEADERS },
          gmailOpts(o),
        );
        return results.map((r, i) => {
          const id = ids[i]!;
          if (r.ok)
            return {
              id,
              kind: "found" as const,
              summary: summaryOfThread(r.value),
            };
          if (isNotFound(r.error)) return { id, kind: "gone" as const };
          return { id, kind: "failed" as const, error: r.error };
        });
      }),

    getThreadContent: (id, o) =>
      neutral(`threads.get ${id}`, async () => {
        let t;
        try {
          t = await client.getThread(id, { format: "full" }, gmailOpts(o));
        } catch (err) {
          if (isNotFound(err)) return { kind: "gone" as const };
          throw err;
        }
        try {
          return {
            kind: "found" as const,
            content: await contentOfThread(t, (m, a) =>
              client.getAttachment(m, a, gmailOpts(o)),
            ),
          };
        } catch (err) {
          // A message deleted while its large body was fetched: the thread
          // as read is gone; the caller re-reads it.
          if (isNotFound(err)) return { kind: "gone" as const };
          throw err;
        }
      }),

    getAttachment: (ref, o) =>
      neutral(`attachment ${ref.partId} of ${ref.messageId}`, async () => {
        const partId = inlinePartOf(ref.handle);
        if (partId === null)
          return client.getAttachment(ref.messageId, ref.handle, gmailOpts(o));
        const m = await client.getMessage(
          ref.messageId,
          { format: "full" },
          gmailOpts(o),
        );
        const bytes = inlinePartBytes(m, partId);
        if (bytes === null) {
          throw new Error(
            `Gmail message ${ref.messageId} has no inline part ${partId}`,
          );
        }
        return bytes;
      }),

    listMailboxes: (o) =>
      neutral("labels", async () => {
        const labels = await client.listLabels(gmailOpts(o));
        const flags = new Set<string>([
          FLAG_LABELS.unread,
          FLAG_LABELS.starred,
        ]);
        const mailboxLabels = labels.filter((l) => !flags.has(l.id));
        const counted = await client.getLabels(
          mailboxLabels.map((l) => l.id),
          gmailOpts(o),
        );
        const withCounts = counted.flatMap((r) => {
          if (r.ok) return [r.value];
          // Deleted between the list and the count: no longer a mailbox.
          if (isNotFound(r.error)) return [];
          throw r.error;
        });
        return mailboxesOfGmailLabels(withCounts);
      }),

    findMessage: (rfc, o) =>
      neutral("messages.list rfc822msgid", () => findMessage(rfc, o)),

    currentCursor: (o) =>
      neutral("users.getProfile", async () =>
        changeCursor((await client.getProfile(gmailOpts(o))).historyId),
      ),

    changesSince: (cursor, o) =>
      neutral(
        `history.list since ${cursor}`,
        async (): Promise<MailChanges> => {
          const changed = new Set<ThreadId>();
          let pageToken: string | undefined;
          let lastRecord: string | null = null;
          for (let page = 0; page < HISTORY_PAGES_PER_CALL; page++) {
            const r = await client.listHistory(
              { startHistoryId: cursor, maxResults: 500, pageToken },
              gmailOpts(o),
            );
            if (r.kind === "expired") return { kind: "reset" };
            for (const rec of r.history) {
              lastRecord = rec.id;
              for (const m of rec.messages ?? [])
                changed.add(threadId(m.threadId));
              for (const list of [
                rec.messagesAdded,
                rec.messagesDeleted,
                rec.labelsAdded,
                rec.labelsRemoved,
              ])
                for (const c of list ?? [])
                  changed.add(threadId(c.message.threadId));
            }
            if (r.nextPageToken === null) {
              return {
                kind: "changes",
                threads: [...changed],
                mailboxes: changed.size > 0 ? "changed" : "unchanged",
                next: changeCursor(r.historyId),
                more: false,
              };
            }
            pageToken = r.nextPageToken;
          }
          // More pages wait: resume after the last record read (history.list
          // returns the records after its start id).
          return {
            kind: "changes",
            threads: [...changed],
            mailboxes: changed.size > 0 ? "changed" : "unchanged",
            next: changeCursor(resumeAfter(lastRecord)),
            more: true,
          };
        },
      ),

    archive: (targets, o) =>
      neutral("archive", () =>
        modifyMessages(targets, { removeLabelIds: [INBOX] }, o),
      ),
    moveToInbox: (targets, o) =>
      neutral("move to inbox", () =>
        modifyMessages(
          targets,
          { addLabelIds: [INBOX], removeLabelIds: [TRASH, SPAM] },
          o,
        ),
      ),
    // Gmail's trash is its TRASH label (what `messages.trash` sets, INBOX
    // dropped with it); `batchModify` sets it for up to 1,000 messages a call.
    trash: (targets, o) =>
      neutral("trash", () =>
        modifyMessages(
          targets,
          { addLabelIds: [TRASH], removeLabelIds: [INBOX] },
          o,
        ),
      ),
    untrash: (targets, o) =>
      neutral("untrash", () =>
        modifyMessages(targets, { removeLabelIds: [TRASH] }, o),
      ),

    setFlags: (targets, flags, o) =>
      neutral("set flags", () => {
        const add: string[] = [];
        const remove: string[] = [];
        if (flags.unread !== undefined)
          (flags.unread ? add : remove).push(FLAG_LABELS.unread);
        if (flags.starred !== undefined)
          (flags.starred ? add : remove).push(FLAG_LABELS.starred);
        if (add.length + remove.length === 0)
          throw new Error("mail: setFlags with no flag to set");
        return modifyMessages(
          targets,
          { addLabelIds: add, removeLabelIds: remove },
          o,
        );
      }),

    setMailboxes: (targets, change, o) =>
      neutral("set mailboxes", () =>
        modifyMessages(
          targets,
          {
            addLabelIds: change.add.map(labelIdOfMailbox),
            removeLabelIds: change.remove.map(labelIdOfMailbox),
          },
          o,
        ),
      ),

    createMailbox: (m, o) =>
      neutral(`create label ${m.name}`, async () => {
        if (m.name.includes("/")) {
          throw new Error(
            `mail: a Gmail label name may not contain "/" (it nests): ${m.name}`,
          );
        }
        const labels = await client.listLabels(gmailOpts(o));
        const mailboxes = mailboxesOfGmailLabels(labels);
        const byId = new Map(mailboxes.map((x) => [x.id, x]));
        let full = m.name;
        if (m.parentId !== null) {
          const parent = byId.get(m.parentId);
          if (!parent)
            throw new Error(
              `mail: no mailbox ${m.parentId} to nest ${m.name} under`,
            );
          const parentName = gmailLabelName(parent, byId);
          if (parentName === null)
            throw new Error(
              `mail: Gmail lists ${m.parentId} without its parent`,
            );
          full = `${parentName}/${m.name}`;
        }
        try {
          const created = await client.createLabel(
            { name: full },
            gmailOpts(o),
          );
          return mailboxOfLabel([...labels, created], created.id);
        } catch (err) {
          // Gmail refuses a duplicate name (409), and a create whose answer
          // was lost may have happened: both are settled by the name, which
          // Gmail keeps unique.
          const byName = async () => {
            const now = await client.listLabels(gmailOpts(o));
            const same = now.find((l) => l.type === "user" && l.name === full);
            return same ? mailboxOfLabel(now, same.id) : null;
          };
          if (err instanceof GmailOutcomeUnknownError)
            return reconcile(`creating label ${full}`, err, byName);
          if (!(err instanceof GmailApiError && err.status === 409)) throw err;
          // Google did nothing: the name is taken. Answer the label holding it.
          const existing = await byName();
          if (existing === null) throw err;
          return existing;
        }
      }),

    renameMailbox: (id, name, o) =>
      neutral(`rename label ${id}`, async () => {
        if (name.includes("/"))
          throw new MailRefusedError(
            `a Gmail label name may not contain "/": ${name}`,
          );
        const labels = await client.listLabels(gmailOpts(o));
        const { label, mailbox, byId } = userLabelIn(labels, id);
        await renameLabels(
          labels,
          [{ label, to: `${prefixUnder(mailbox.parentId, byId)}${name}` }],
          o,
        );
      }),

    moveMailbox: (id, parentId, o) =>
      neutral(`move label ${id}`, async () => {
        const labels = await client.listLabels(gmailOpts(o));
        const { label, mailbox, byId } = userLabelIn(labels, id);
        for (
          let at = parentId;
          at !== null;
          at = byId.get(at)?.parentId ?? null
        ) {
          if (at === id) {
            throw new MailRefusedError(
              `a label cannot move under itself (${label.name})`,
            );
          }
        }
        if (parentId !== null && mailbox.name.includes("/")) {
          // A root named "a/b" nested would read as "P/a/b": a label "b"
          // under a missing "P/a", not this one under P.
          throw new MailRefusedError(
            `“${mailbox.name}” holds a "/", so Gmail cannot nest it: rename it first`,
          );
        }
        await renameLabels(
          labels,
          [{ label, to: `${prefixUnder(parentId, byId)}${mailbox.name}` }],
          o,
        );
      }),

    setMailboxColor: (id, color, o) =>
      neutral(`colour label ${id}`, async () => {
        if (color !== null && !isGmailLabelColor(color)) {
          throw new MailRefusedError(
            `${color.background} on ${color.text} is not on Gmail's label palette`,
          );
        }
        await client.patchLabel(
          labelIdOfMailbox(id),
          {
            color:
              color === null
                ? null
                : { backgroundColor: color.background, textColor: color.text },
          },
          gmailOpts(o),
        );
      }),

    deleteMailbox: (id, o) =>
      neutral(`delete label ${id}`, async () => {
        // Gmail nests by name and keeps a deleted parent's sub-labels as
        // they are ("Work/Clients" would stay, a root named with its old
        // path): each moves up to the deleted label's parent first, as the
        // contract says (and the tag picker's Delete does) — all checked
        // for clashes before the first write.
        const labels = await client.listLabels(gmailOpts(o));
        const { label, mailbox, byId } = userLabelIn(labels, id);
        const prefix = prefixUnder(mailbox.parentId, byId);
        const children = [...byId.values()].filter((m) => m.parentId === id);
        await renameLabels(
          labels,
          children.map((child) => ({
            label: labels.find((l) => l.id === labelIdOfMailbox(child.id))!,
            to: `${prefix}${child.name}`,
          })),
          o,
        );
        await client.deleteLabel(label.id, gmailOpts(o));
      }),

    saveDraft: (m, existing, o) =>
      neutral("save draft", async () => {
        assertOutgoingMessageId(m);
        const outgoing = {
          rfc822: withSentIdHeader(m.mime, m.rfc822MessageId),
          threadId: m.threadId ?? undefined,
        };
        let d = null;
        if (existing !== null) {
          try {
            d = await client.updateDraft(existing, outgoing, gmailOpts(o));
          } catch (err) {
            // Deleted elsewhere (Gmail web): it is made again below.
            if (!isNotFound(err)) throw asRefused(err);
          }
        }
        if (d === null) {
          try {
            d = await client.createDraft(outgoing, gmailOpts(o));
          } catch (err) {
            if (!(err instanceof GmailOutcomeUnknownError))
              throw asRefused(err);
            return reconcile("creating a draft", err, async () => {
              const found = await findMessage(m.rfc822MessageId, o);
              if (found.kind === "absent") return null;
              const draft = await draftOfMessage(found.messageId, o);
              return draft === null
                ? null
                : {
                    draftId: draft,
                    messageId: found.messageId,
                    threadId: found.threadId,
                  };
            });
          }
        }
        return {
          draftId: draftId(d.id),
          messageId: messageId(d.message.id),
          threadId: threadId(d.message.threadId),
        };
      }),

    findDraft: (id, o) =>
      neutral(`find the draft of message ${id}`, async () => {
        const d = await draftOfMessage(id, o);
        return d === null
          ? { kind: "absent" as const }
          : { kind: "found" as const, draftId: d };
      }),

    deleteDraft: (id, o) =>
      neutral(`delete draft ${id}`, async () => {
        try {
          await client.deleteDraft(id, gmailOpts(o));
        } catch (err) {
          // Gone already (sent, or deleted elsewhere): the target state holds.
          if (!isNotFound(err)) throw err;
        }
      }),

    send: (m: OutgoingMessage, o) =>
      neutral("send", async () => {
        assertOutgoingMessageId(m);
        try {
          const sent = await client.sendMessage(
            {
              rfc822: withSentIdHeader(m.mime, m.rfc822MessageId),
              threadId: m.threadId ?? undefined,
            },
            gmailOpts(o),
          );
          return {
            messageId: messageId(sent.id),
            threadId: threadId(sent.threadId),
          };
        } catch (err) {
          if (!(err instanceof GmailOutcomeUnknownError)) throw asRefused(err);
          // Never resent blindly: the Message-ID says whether it went.
          return reconcile("sending", err, async () => {
            const found = await findMessage(m.rfc822MessageId, o);
            return found.kind === "found"
              ? { messageId: found.messageId, threadId: found.threadId }
              : null;
          });
        }
      }),
  } satisfies MailProvider;
}
