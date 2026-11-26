import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@plugins/database/server";
import { HttpError } from "@plugins/infra/plugins/endpoints/server";
import { createKeyedMutex } from "@plugins/packages/plugins/keyed-mutex/core";
import {
  buildMimeMessage,
  newMessageId,
  type MimeAttachment,
} from "@plugins/packages/plugins/mime/core";
import {
  MailNotConnectedError,
  MailOutcomeUnknownError,
  MailRefusedError,
  MailUnreachableError,
  draftId as toDraftId,
  messageId as toMessageId,
  threadId as toThreadId,
  type MailProvider,
  type MessageContent,
  type Participant,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import type {
  MailSender,
  MailThreadRead,
} from "@plugins/apps/plugins/mail/plugins/cache/server";
import {
  EMPTY_DRAFT_CONTENT,
  formatAddressList,
  isDraftEmpty,
  messageIdsIn,
  MAIL_ATTACHMENTS_MAX_BYTES,
  mailDraftIdKind,
  parseAddressList,
  plainTextOf,
  startFrom,
  type DraftAttachment,
  type DraftContent,
  type DraftStart,
  type MailDraft,
  type MailDraftId,
} from "../../core";
import { _mailDrafts } from "./tables";

type DraftRow = typeof _mailDrafts.$inferSelect;

/** A send whose outcome is not known yet, or a lookup that has not found it: the job runs again. */
export class SendPendingError extends Error {
  override name = "SendPendingError";
}

/** A send the provider refused as asked (nothing went): not retried, the draft reopens with the reason. */
export class SendRefusedError extends Error {
  override name = "SendRefusedError";
}

export type OutboxDeps = {
  db: Db;
  /** The account mail is written from (`mailCache.sender`). */
  sender: () => Promise<MailSender>;
  /** A thread's content as the reader reads it (`mailCache.thread`). */
  thread: (id: string) => Promise<Pick<MailThreadRead, "content">>;
  /** One file of a forwarded message, kept (its attachment id) or fetched and kept. */
  forwardedFile: (
    a: Extract<DraftAttachment, { kind: "forwarded" }>,
  ) => Promise<{
    attachmentId: string;
    bytes: Uint8Array;
  }>;
  /** An uploaded file's bytes (`readAttachmentBytes`). */
  uploadBytes: (attachmentId: string) => Promise<Uint8Array>;
  /** Imports a draft message's own file as an upload; answers its attachment id. */
  importFile: (f: {
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  }) => Promise<string>;
  /** Links the draft's files (uploads and kept forwarded parts) so the sweep keeps them. */
  linkFiles: (
    draftId: string,
    attachmentIds: readonly string[],
  ) => Promise<void>;
  /** The attachment id a forwarded part is kept under (name-derived). */
  forwardedFileId: (
    a: Extract<DraftAttachment, { kind: "forwarded" }>,
  ) => Promise<string>;
  /** The undo-send delay, read per send. */
  undoSendMs: () => number;
  /** Queues the provider mirror of a draft (settled: a burst of saves is one run). */
  enqueueMirror: (draftId: MailDraftId) => Promise<void>;
  /** Queues the send of a draft to run at `at` (its job carries `at`: a later send's job is told apart). */
  enqueueSend: (draftId: MailDraftId, at: Date) => Promise<void>;
  /** The cache should learn what moved (a send landed): its sync step, coalesced. */
  syncSoon: () => void;
  now?: () => Date;
};

/** The domain a Message-ID is minted under: the sender's own. */
function domainOf(address: string): string {
  const d = address.split("@")[1] ?? "";
  return /^[A-Za-z0-9.-]+$/.test(d) ? d : "mail.equin.invalid";
}

/** A recipient field read for sending: every address valid, or the 400 naming the ones that are not. */
function recipients(field: string, what: string): Participant[] {
  const p = parseAddressList(field);
  if (p.kind === "invalid") {
    throw new HttpError(
      400,
      `${what}: ${p.invalid.map((x) => `"${x}"`).join(", ")} ${p.invalid.length === 1 ? "is not an email address" : "are not email addresses"}`,
    );
  }
  return p.addresses;
}

/** A recipient field read for a draft's mirror: the addresses that parse (a half-typed one is left out of the provider's copy). */
function draftRecipients(field: string): Participant[] {
  return parseAddressList(field).addresses;
}

/** The text a message carries: the body, then (a reply) the quote of what it answers. */
function messageText(body: string, quote: string | null): string {
  return quote === null ? body : `${body.replace(/\s+$/, "")}\n\n${quote}\n`;
}

export function createOutbox(deps: OutboxDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  // One provider-facing run per draft at a time: a mirror never races its
  // send (an orphan draft made after the send deleted it) or its discard.
  const draftMutex = createKeyedMutex("mail-draft");

  async function row(id: string): Promise<DraftRow | null> {
    const [r] = await db
      .select()
      .from(_mailDrafts)
      .where(eq(_mailDrafts.id, mailDraftIdKind.key(id)));
    return r ?? null;
  }

  function toDraft(r: DraftRow): MailDraft {
    if (r.state === "discarded")
      throw new Error("a discarded draft is not drawn");
    return {
      id: r.id,
      kind: r.kind,
      threadId: r.threadId ?? r.providerThreadId,
      replyingTo: r.replyingTo,
      state: r.state,
      sendAt: r.sendAt?.toISOString() ?? null,
      sendError: r.sendError,
      content: r.content,
    };
  }

  /** The draft as `mail.draft` answers it, or null (missing: discarded, cleared or never started). */
  async function read(id: string): Promise<MailDraft | null> {
    const r = await row(id);
    return r === null || r.state === "discarded" ? null : toDraft(r);
  }

  async function attachmentIdsOf(content: DraftContent): Promise<string[]> {
    return Promise.all(
      content.attachments.map(async (a) =>
        a.kind === "upload" ? a.attachmentId : await deps.forwardedFileId(a),
      ),
    );
  }

  /** The message a start answers, read from its thread (a 404 when the thread no longer holds it). */
  async function sourceMessage(
    threadId: string,
    messageId: string,
  ): Promise<{
    read: Pick<MailThreadRead, "content">;
    message: MessageContent;
  }> {
    const read = await deps.thread(threadId);
    const message = read.content.messages.find((m) => m.id === messageId);
    if (!message) {
      throw new HttpError(
        404,
        `This conversation no longer holds message ${messageId}.`,
      );
    }
    return { read, message };
  }

  // ── start ───────────────────────────────────────────────────────────────

  async function insert(
    id: MailDraftId,
    accountId: string,
    domain: string,
    v: Partial<typeof _mailDrafts.$inferInsert> &
      Pick<typeof _mailDrafts.$inferInsert, "kind" | "content">,
  ): Promise<DraftRow> {
    const [r] = await db
      .insert(_mailDrafts)
      .values({
        id,
        accountId,
        draftMessageId: newMessageId(domain),
        state: "editing",
        ...v,
      })
      .onConflictDoNothing({ target: _mailDrafts.id })
      .returning();
    // A second start under the same id (a retried request): the draft as it is.
    return r ?? (await row(id))!;
  }

  /**
   * Continues a draft message the provider holds: the local draft already
   * mirroring it, else a new one adopting it (its content read from the
   * message, its own files kept as uploads, linked to the provider's draft
   * so the next save replaces it rather than adding a second).
   */
  async function adopt(
    id: MailDraftId,
    sender: MailSender,
    threadId: string,
    messageId: string,
  ): Promise<DraftRow> {
    const [mine] = await db
      .select()
      .from(_mailDrafts)
      .where(eq(_mailDrafts.providerMessageId, messageId));
    if (mine && mine.state !== "discarded") return mine;
    const { read, message } = await sourceMessage(threadId, messageId);
    if (!message.isDraft) {
      throw new HttpError(400, `Message ${messageId} is not a draft.`);
    }
    const found = await sender.provider.findDraft(toMessageId(messageId));
    if (found.kind === "absent") {
      throw new HttpError(
        404,
        "This draft is gone (sent or deleted elsewhere).",
      );
    }
    const [held] = await db
      .select()
      .from(_mailDrafts)
      .where(eq(_mailDrafts.providerDraftId, found.draftId as string));
    if (held && held.state !== "discarded") return held;
    const files: DraftAttachment[] = [];
    for (const a of message.attachments.filter((x) => !x.inline)) {
      const bytes = await sender.provider.getAttachment(a.ref);
      files.push({
        kind: "upload",
        attachmentId: await deps.importFile({
          filename: a.filename || `attachment-${a.ref.partId}`,
          mimeType: a.mimeType || "application/octet-stream",
          bytes,
        }),
        filename: a.filename || `attachment-${a.ref.partId}`,
        mimeType: a.mimeType || "application/octet-stream",
        size: bytes.byteLength,
      });
    }
    const answers = read.content.messages.some((m) => !m.isDraft);
    const content: DraftContent = {
      to: formatAddressList(message.to),
      cc: formatAddressList(message.cc),
      bcc: formatAddressList(message.bcc),
      subject: message.subject,
      body: plainTextOf(message),
      attachments: files,
    };
    const r = await insert(id, sender.accountId, domainOf(sender.address), {
      kind: answers ? "reply" : "new",
      threadId: answers ? threadId : null,
      inReplyTo: messageIdsIn(message.inReplyTo)[0] ?? null,
      references: message.references.flatMap(messageIdsIn),
      content,
      providerDraftId: found.draftId as string,
      providerThreadId: threadId,
      providerMessageId: messageId,
      draftMessageId:
        message.rfc822MessageId ?? newMessageId(domainOf(sender.address)),
    });
    await deps.linkFiles(r.id, await attachmentIdsOf(r.content));
    return r;
  }

  /** Starts (or answers, under an id already used) a draft. */
  async function start(idText: string, s: DraftStart): Promise<MailDraft> {
    const id = mailDraftIdKind.parse(idText);
    const existing = await row(id);
    if (existing && existing.state !== "discarded") return toDraft(existing);
    if (existing) throw new HttpError(409, "This draft was discarded.");
    const sender = await deps.sender();
    const domain = domainOf(sender.address);
    if (s.kind === "new") {
      return toDraft(
        await insert(id, sender.accountId, domain, {
          kind: "new",
          content: EMPTY_DRAFT_CONTENT,
        }),
      );
    }
    if (s.kind === "continue") {
      return toDraft(await adopt(id, sender, s.threadId, s.messageId));
    }
    const { message } = await sourceMessage(s.threadId, s.messageId);
    const c = startFrom(s.kind, message, sender.address, s.threadId);
    const r = await insert(id, sender.accountId, domain, {
      kind: s.kind,
      threadId: s.threadId,
      replyingTo: c.replyingTo,
      inReplyTo: c.inReplyTo,
      references: c.references,
      quote: c.quote,
      content: {
        to: c.to,
        cc: c.cc,
        bcc: "",
        subject: c.subject,
        body: c.body,
        attachments: c.attachments,
      },
    });
    await deps.linkFiles(r.id, await attachmentIdsOf(r.content));
    return toDraft(r);
  }

  // ── save / send / undo / discard ───────────────────────────────────────

  /** What a write found when its row was not in the state it needs: 404 missing, 409 otherwise. */
  async function refusedWrite(id: string, doing: string): Promise<never> {
    const r = await row(id);
    if (r === null || r.state === "discarded") {
      throw new HttpError(404, "This draft is gone.");
    }
    throw new HttpError(
      409,
      `Cannot ${doing}: this draft is ${r.state === "queued" ? "waiting to be sent (Undo takes it back)" : r.state === "sending" ? "being sent" : "sent"}.`,
    );
  }

  async function save(idText: string, content: DraftContent): Promise<void> {
    const id = mailDraftIdKind.key(idText);
    // Files first: one that is not there fails the save before it lands.
    await deps.linkFiles(id, await attachmentIdsOf(content));
    const done = await db
      .update(_mailDrafts)
      .set({
        content,
        revision: sql`${_mailDrafts.revision} + 1`,
      })
      .where(and(eq(_mailDrafts.id, id), eq(_mailDrafts.state, "editing")))
      .returning({ id: _mailDrafts.id });
    if (done.length === 0) await refusedWrite(id, "save");
    await deps.enqueueMirror(id);
  }

  async function send(
    idText: string,
    content: DraftContent,
  ): Promise<{ sendAt: string }> {
    const id = mailDraftIdKind.key(idText);
    const all = [
      ...recipients(content.to, "To"),
      ...recipients(content.cc, "Cc"),
      ...recipients(content.bcc, "Bcc"),
    ];
    if (all.length === 0)
      throw new HttpError(400, "Add at least one recipient.");
    const bytes = content.attachments.reduce((n, a) => n + a.size, 0);
    if (bytes > MAIL_ATTACHMENTS_MAX_BYTES) {
      throw new HttpError(
        400,
        `The files come to ${(bytes / 1024 / 1024).toFixed(1)} MB; a message carries at most ${MAIL_ATTACHMENTS_MAX_BYTES / 1024 / 1024} MB.`,
      );
    }
    const sendAt = new Date(now().getTime() + deps.undoSendMs());
    await deps.linkFiles(id, await attachmentIdsOf(content));
    const done = await db
      .update(_mailDrafts)
      .set({
        content,
        revision: sql`${_mailDrafts.revision} + 1`,
        state: "queued",
        sendAt,
        sendError: null,
        sendAttempt: null,
        sendMessageId: null,
      })
      .where(and(eq(_mailDrafts.id, id), eq(_mailDrafts.state, "editing")))
      .returning({ id: _mailDrafts.id });
    if (done.length === 0) await refusedWrite(id, "send");
    await deps.enqueueSend(id, sendAt);
    return { sendAt: sendAt.toISOString() };
  }

  async function undoSend(
    idText: string,
  ): Promise<{ kind: "reopened" | "too-late" }> {
    const id = mailDraftIdKind.key(idText);
    const done = await db
      .update(_mailDrafts)
      .set({ state: "editing", sendAt: null })
      .where(and(eq(_mailDrafts.id, id), eq(_mailDrafts.state, "queued")))
      .returning({ id: _mailDrafts.id });
    if (done.length === 0) {
      const r = await row(id);
      if (r === null || r.state === "discarded")
        throw new HttpError(404, "This draft is gone.");
      return { kind: "too-late" };
    }
    // What was sent is newer than the provider's draft: mirror it.
    await deps.enqueueMirror(id);
    return { kind: "reopened" };
  }

  async function discard(idText: string): Promise<void> {
    const id = mailDraftIdKind.key(idText);
    const done = await db
      .update(_mailDrafts)
      .set({ state: "discarded" })
      .where(and(eq(_mailDrafts.id, id), eq(_mailDrafts.state, "editing")))
      .returning({ id: _mailDrafts.id });
    if (done.length === 0) {
      const r = await row(id);
      if (r === null || r.state === "discarded") return;
      await refusedWrite(id, "discard");
    }
    await deps.enqueueMirror(id);
  }

  // ── building the message ────────────────────────────────────────────────

  async function files(content: DraftContent): Promise<MimeAttachment[]> {
    const out: MimeAttachment[] = [];
    for (const a of content.attachments) {
      const bytes =
        a.kind === "upload"
          ? await deps.uploadBytes(a.attachmentId)
          : (await deps.forwardedFile(a)).bytes;
      out.push({ filename: a.filename, mimeType: a.mimeType, bytes });
    }
    return out;
  }

  async function mime(
    r: DraftRow,
    sender: MailSender,
    o: { messageId: string; strict: boolean },
  ): Promise<Uint8Array> {
    const read = o.strict ? recipients : (f: string) => draftRecipients(f);
    return buildMimeMessage({
      from: { name: null, address: sender.address },
      to: read(r.content.to, "To"),
      cc: read(r.content.cc, "Cc"),
      bcc: read(r.content.bcc, "Bcc"),
      subject: r.content.subject,
      date: now(),
      messageId: o.messageId,
      inReplyTo: r.inReplyTo,
      references: r.references,
      text: messageText(r.content.body, r.quote),
      attachments: await files(r.content),
    });
  }

  // ── the provider's half: the mirror ────────────────────────────────────

  /**
   * The provider's draft of a row: the one it holds, else — when a create's
   * answer was lost (`draftCreateAttempt` unknown) — the draft the provider
   * may have made, found by the draft's Message-ID. Null: none.
   */
  async function providerDraftOf(
    r: DraftRow,
    provider: MailProvider,
  ): Promise<string | null> {
    if (r.providerDraftId !== null) return r.providerDraftId;
    if (r.draftCreateAttempt !== "unknown") return null;
    const found = await provider.findMessage(r.draftMessageId);
    if (found.kind === "absent") return null;
    const d = await provider.findDraft(found.messageId);
    return d.kind === "found" ? (d.draftId as string) : null;
  }

  /**
   * Brings the provider's copy of a draft to its row (`mail.draft-mirror`,
   * settled per draft): a discarded draft's provider draft deleted and its
   * row with it; an editing one saved when its revision moved (created the
   * first time, replaced after); a queued, sending or sent one left to the
   * send.
   */
  async function mirror(idText: string): Promise<void> {
    const id = mailDraftIdKind.key(idText);
    await draftMutex.run(id, async () => {
      const r = await row(id);
      if (r === null) return;
      if (r.state === "discarded") {
        if (r.providerDraftId !== null || r.draftCreateAttempt === "unknown") {
          const sender = await deps.sender();
          const draft = await providerDraftOf(r, sender.provider);
          if (draft !== null)
            await sender.provider.deleteDraft(toDraftId(draft));
        }
        await db.delete(_mailDrafts).where(eq(_mailDrafts.id, id));
        deps.syncSoon();
        return;
      }
      if (r.state !== "editing" || r.revision === r.mirroredRevision) return;
      if (isDraftEmpty(r.content) && r.providerDraftId === null) {
        await db
          .update(_mailDrafts)
          .set({ mirroredRevision: r.revision })
          .where(eq(_mailDrafts.id, id));
        return;
      }
      const sender = await deps.sender();
      const existing = await providerDraftOf(r, sender.provider);
      if (existing === null) {
        // A create whose answer is lost is looked up, never made twice.
        await db
          .update(_mailDrafts)
          .set({ draftCreateAttempt: "unknown" })
          .where(eq(_mailDrafts.id, id));
      }
      const saved = await sender.provider.saveDraft(
        {
          mime: await mime(r, sender, {
            messageId: r.draftMessageId,
            strict: false,
          }),
          threadId:
            r.providerThreadId !== null
              ? toThreadId(r.providerThreadId)
              : r.threadId !== null
                ? toThreadId(r.threadId)
                : null,
          rfc822MessageId: r.draftMessageId,
        },
        existing === null ? null : toDraftId(existing),
      );
      await db
        .update(_mailDrafts)
        .set({
          providerDraftId: saved.draftId as string,
          providerThreadId: saved.threadId as string,
          providerMessageId: saved.messageId as string,
          draftCreateAttempt: null,
          mirroredRevision: r.revision,
        })
        .where(eq(_mailDrafts.id, id));
      deps.syncSoon();
    });
  }

  // ── the provider's half: the send ──────────────────────────────────────

  /** Marks a draft sent and deletes its provider draft (idempotent: a retry finishes what is left). */
  async function finishSent(
    r: DraftRow,
    provider: MailProvider,
    sent: { messageId: string; threadId: string } | null,
  ): Promise<void> {
    if (sent !== null) {
      await db
        .update(_mailDrafts)
        .set({
          state: "sent",
          sentMessageId: sent.messageId,
          sentThreadId: sent.threadId,
          sentAt: now(),
          sendError: null,
        })
        .where(eq(_mailDrafts.id, r.id));
    }
    const draft = await providerDraftOf(r, provider);
    if (draft !== null) await provider.deleteDraft(toDraftId(draft));
    if (r.providerDraftId !== null || r.draftCreateAttempt !== null) {
      await db
        .update(_mailDrafts)
        .set({ providerDraftId: null, draftCreateAttempt: null })
        .where(eq(_mailDrafts.id, r.id));
    }
    deps.syncSoon();
  }

  /**
   * Sends a queued draft once its time has come (`mail.send`). Never twice:
   * it claims the draft (queued → sending, minting the send's own
   * Message-ID) before the provider sees it; marks the attempt `unknown`
   * before the call, so a crash or a lost answer is settled by
   * `findMessage(that id)` on the next attempt, never by sending again; and
   * only an attempt known not to have reached the provider (`not-sent`) is
   * sent again.
   */
  async function sendDue(idText: string, due: string): Promise<void> {
    const id = mailDraftIdKind.key(idText);
    await draftMutex.run(id, async () => {
      let r = await row(id);
      if (r === null) return;
      const sender = await deps.sender();
      if (r.state === "sent") {
        // A retry after the send landed: only the provider draft may be left.
        if (r.providerDraftId !== null || r.draftCreateAttempt !== null)
          await finishSent(r, sender.provider, null);
        return;
      }
      if (r.state === "queued") {
        // Undone and sent again: this job is the old send's — the new one's
        // own job comes at its time.
        if (r.sendAt?.toISOString() !== due) return;
        // The queue ran it before its time: loud, and run again.
        if (r.sendAt.getTime() > now().getTime()) {
          throw new SendPendingError(
            `The send of draft ${id} ran before its time (${due}).`,
          );
        }
        const [claimed] = await db
          .update(_mailDrafts)
          .set({
            state: "sending",
            sendMessageId: newMessageId(domainOf(sender.address)),
            sendAttempt: "not-sent",
          })
          .where(
            and(
              eq(_mailDrafts.id, id),
              eq(_mailDrafts.state, "queued"),
              lte(_mailDrafts.sendAt, now()),
            ),
          )
          .returning();
        if (!claimed) return;
        r = claimed;
      } else if (r.state !== "sending") {
        return;
      }
      const sendMessageId = r.sendMessageId!;
      if (r.sendAttempt === "unknown") {
        const found = await sender.provider.findMessage(sendMessageId);
        if (found.kind === "found") {
          await finishSent(r, sender.provider, {
            messageId: found.messageId as string,
            threadId: found.threadId as string,
          });
          return;
        }
        throw new SendPendingError(
          `The send of ${sendMessageId} may have reached the provider and is not found there yet; looking again before anything is sent again.`,
        );
      }
      const bytes = await mime(r, sender, {
        messageId: sendMessageId,
        strict: true,
      });
      await db
        .update(_mailDrafts)
        .set({ sendAttempt: "unknown" })
        .where(eq(_mailDrafts.id, id));
      let sent;
      try {
        sent = await sender.provider.send({
          mime: bytes,
          threadId: r.threadId === null ? null : toThreadId(r.threadId),
          rfc822MessageId: sendMessageId,
        });
      } catch (err) {
        if (err instanceof MailOutcomeUnknownError) throw err;
        // The provider never had it (offline, not connected, refused as
        // asked): sending again is safe.
        if (
          err instanceof MailUnreachableError ||
          err instanceof MailNotConnectedError ||
          err instanceof MailRefusedError
        ) {
          await db
            .update(_mailDrafts)
            .set({ sendAttempt: "not-sent" })
            .where(eq(_mailDrafts.id, id));
          if (err instanceof MailRefusedError)
            throw new SendRefusedError(err.message);
        }
        throw err;
      }
      await finishSent(r, sender.provider, {
        messageId: sent.messageId as string,
        threadId: sent.threadId as string,
      });
    });
  }

  /**
   * A send given up (`mail.send`'s onDead): back to the draft with the reason,
   * so the person sees it and decides. When the provider may have it (an
   * attempt `unknown`), the reason says so: check Sent before sending again.
   */
  async function sendFailed(
    idText: string,
    error: string,
  ): Promise<DraftRow | null> {
    const id = mailDraftIdKind.key(idText);
    const r = await row(id);
    if (r === null || !(r.state === "queued" || r.state === "sending"))
      return null;
    const message =
      r.sendAttempt === "unknown"
        ? `It may have been sent: the provider did not answer and the message was not found in your mail. Check Sent before sending it again. (${error})`
        : `It was not sent: ${error}`;
    const [back] = await db
      .update(_mailDrafts)
      .set({
        state: "editing",
        sendAt: null,
        sendError: message,
      })
      .where(
        and(
          eq(_mailDrafts.id, id),
          inArray(_mailDrafts.state, ["queued", "sending"]),
        ),
      )
      .returning();
    if (back) await deps.enqueueMirror(id);
    return back ?? null;
  }

  return {
    read,
    start,
    save,
    send,
    undoSend,
    discard,
    mirror,
    sendDue,
    sendFailed,
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
