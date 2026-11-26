import { createSemaphore } from "@plugins/packages/plugins/semaphore/core";
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
  MailUnreachableError,
  messageId,
  threadId,
  type Mailbox,
  type MailCallOptions,
  type MailChanges,
  type MailProvider,
  type OutgoingMessage,
  type ThreadId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import { withCut } from "./compile-query";
import { contentOfThread, inlinePartBytes, inlinePartOf } from "./content";
import {
  FLAG_LABELS,
  GMAIL_ROLE_LABELS,
  gmailLabelName,
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
/** Per-thread writes in flight at once: Google limits a user's concurrent requests beyond its quota. */
const WRITE_CONCURRENCY = 8;

const INBOX = GMAIL_ROLE_LABELS.inbox.labelId;
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

const isNotFound = (err: unknown) =>
  err instanceof GmailApiError && err.status === 404;

/**
 * The contract over one account's Gmail client. Stateless: the client holds
 * the account's pacer; the definition holds the one client per account.
 */
export function createGmailMailProvider(client: GmailClient): MailProvider {
  const writes = createSemaphore(WRITE_CONCURRENCY);
  async function eachThread(
    ids: readonly ThreadId[],
    fn: (id: ThreadId) => Promise<unknown>,
  ): Promise<void> {
    // Every write settles before the call answers, so a caller never re-reads
    // while some are still landing.
    const settled = await Promise.allSettled(
      ids.map((id) => writes.run(() => fn(id))),
    );
    const failed = settled.flatMap((r, i) =>
      r.status === "rejected"
        ? [{ id: ids[i]!, error: r.reason as unknown }]
        : [],
    );
    if (failed.length === 0) return;
    // One failure is thrown as itself, so neutral() still types it.
    if (failed.length === 1) throw failed[0]!.error;
    throw new AggregateError(
      failed.map((f) => f.error),
      `mail: ${failed.length} of ${ids.length} threads were not changed: ${failed.map((f) => f.id).join(", ")}`,
    );
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

  /** The mailbox label `id` is, read among `labels` (its parent is found by name). */
  function mailboxOfLabel(labels: readonly GmailLabel[], id: string): Mailbox {
    const mine = mailboxesOfGmailLabels(labels).find((x) => x.id === id);
    if (!mine) throw new Error(`mail: Gmail label ${id} is not a mailbox`);
    return mine;
  }

  async function findMessage(rfc: string, o?: MailCallOptions) {
    const r = await client.listMessages(
      { q: rfc822Term(rfc), includeSpamTrash: true, maxResults: 1 },
      gmailOpts(o),
    );
    const hit = r.messages?.[0];
    return hit
      ? {
          kind: "found" as const,
          messageId: messageId(hit.id),
          threadId: threadId(hit.threadId),
        }
      : { kind: "absent" as const };
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

    archive: (ids, o) =>
      neutral("archive", () =>
        eachThread(ids, (id) =>
          client.modifyThread(id, { removeLabelIds: [INBOX] }, gmailOpts(o)),
        ),
      ),
    moveToInbox: (ids, o) =>
      neutral("move to inbox", () =>
        eachThread(ids, async (id) => {
          await client.untrashThread(id, gmailOpts(o));
          await client.modifyThread(
            id,
            { addLabelIds: [INBOX], removeLabelIds: [SPAM] },
            gmailOpts(o),
          );
        }),
      ),
    trash: (ids, o) =>
      neutral("trash", () =>
        eachThread(ids, (id) => client.trashThread(id, gmailOpts(o))),
      ),
    untrash: (ids, o) =>
      neutral("untrash", () =>
        eachThread(ids, (id) => client.untrashThread(id, gmailOpts(o))),
      ),
    deleteForever: (ids, o) =>
      neutral("delete", () =>
        eachThread(ids, (id) => client.deleteThread(id, gmailOpts(o))),
      ),

    setFlags: (ids, flags, o) =>
      neutral("set flags", () => {
        const add: string[] = [];
        const remove: string[] = [];
        if (flags.unread !== undefined)
          (flags.unread ? add : remove).push(FLAG_LABELS.unread);
        if (flags.starred !== undefined)
          (flags.starred ? add : remove).push(FLAG_LABELS.starred);
        if (add.length + remove.length === 0)
          throw new Error("mail: setFlags with no flag to set");
        return eachThread(ids, (id) =>
          client.modifyThread(
            id,
            { addLabelIds: add, removeLabelIds: remove },
            gmailOpts(o),
          ),
        );
      }),

    setMailboxes: (ids, change, o) =>
      neutral("set mailboxes", () => {
        const add = change.add.map(labelIdOfMailbox);
        const remove = change.remove.map(labelIdOfMailbox);
        return eachThread(ids, (id) =>
          client.modifyThread(
            id,
            { addLabelIds: add, removeLabelIds: remove },
            gmailOpts(o),
          ),
        );
      }),

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
          throw new Error(
            `mail: a Gmail label name may not contain "/": ${name}`,
          );
        const label = await client.getLabel(labelIdOfMailbox(id), gmailOpts(o));
        if (label.type === "system")
          throw new Error(`mail: Gmail's ${label.name} cannot be renamed`);
        const slash = label.name.lastIndexOf("/");
        await client.patchLabel(
          label.id,
          {
            name:
              slash === -1 ? name : `${label.name.slice(0, slash + 1)}${name}`,
          },
          gmailOpts(o),
        );
      }),

    deleteMailbox: (id, o) =>
      neutral(`delete label ${id}`, () =>
        client.deleteLabel(labelIdOfMailbox(id), gmailOpts(o)),
      ),

    saveDraft: (m, existing, o) =>
      neutral("save draft", async () => {
        assertOutgoingMessageId(m);
        const outgoing = { rfc822: m.mime, threadId: m.threadId ?? undefined };
        let d;
        if (existing !== null) {
          d = await client.updateDraft(existing, outgoing, gmailOpts(o));
        } else {
          try {
            d = await client.createDraft(outgoing, gmailOpts(o));
          } catch (err) {
            if (!(err instanceof GmailOutcomeUnknownError)) throw err;
            return reconcile("creating a draft", err, async () => {
              const found = await client.listDrafts(
                { q: rfc822Term(m.rfc822MessageId), maxResults: 1 },
                gmailOpts(o),
              );
              const hit = found.drafts[0];
              return hit
                ? {
                    draftId: draftId(hit.id),
                    messageId: messageId(hit.message.id),
                    threadId: threadId(hit.message.threadId),
                  }
                : null;
            });
          }
        }
        return {
          draftId: draftId(d.id),
          messageId: messageId(d.message.id),
          threadId: threadId(d.message.threadId),
        };
      }),

    deleteDraft: (id, o) =>
      neutral(`delete draft ${id}`, () => client.deleteDraft(id, gmailOpts(o))),

    send: (m: OutgoingMessage, o) =>
      neutral("send", async () => {
        assertOutgoingMessageId(m);
        try {
          const sent = await client.sendMessage(
            { rfc822: m.mime, threadId: m.threadId ?? undefined },
            gmailOpts(o),
          );
          return {
            messageId: messageId(sent.id),
            threadId: threadId(sent.threadId),
          };
        } catch (err) {
          if (!(err instanceof GmailOutcomeUnknownError)) throw err;
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
