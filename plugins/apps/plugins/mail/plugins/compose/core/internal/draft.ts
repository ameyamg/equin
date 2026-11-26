import { z } from "zod";
import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";
import { liveValue } from "@plugins/network/plugins/live/core";
import { cappedList } from "@plugins/packages/plugins/list-bound/core";
import { mailDraftIdKind } from "./id-kinds";

// Drafts and the outbox (design §6, research/2026-11-26-apps-mail-on-demand-cache-provider.md).
// A draft's working copy is the server's `mail_drafts` row: the editor saves
// into it (debounced), a settled job mirrors it to the provider's drafts, and
// Send queues it in the outbox for the undo-send delay.

/** Gmail's limit on one message's size, and so on a draft's files together. */
export const MAIL_ATTACHMENTS_MAX_BYTES = 25 * 1024 * 1024;

/** The most files one draft carries. */
export const MAIL_DRAFT_ATTACHMENTS_MAX = 100;

/** What a draft is: a new message, an answer to one, or a forward of one. */
export const DRAFT_KINDS = ["new", "reply", "reply-all", "forward"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/**
 * A file the draft sends: one uploaded (`infra/attachments`, linked to the
 * draft so the sweep keeps it) or one of a forwarded message, fetched from
 * the provider when the message is built.
 */
export const DraftAttachmentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("upload"),
    attachmentId: z.string().uuid(),
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    size: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("forwarded"),
    threadId: z.string().min(1),
    messageId: z.string().min(1),
    partId: z.string().min(1),
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    size: z.number().int().nonnegative(),
  }),
]);
export type DraftAttachment = z.infer<typeof DraftAttachmentSchema>;

/** What the person writes: recipient fields as typed (`parseAddressList` reads them), subject, body, files. */
export const DraftContentSchema = z.object({
  to: z.string().max(20_000),
  cc: z.string().max(20_000),
  bcc: z.string().max(20_000),
  subject: z.string().max(998),
  body: z.string().max(2_000_000),
  attachments: cappedList(DraftAttachmentSchema, {
    max: MAIL_DRAFT_ATTACHMENTS_MAX,
  }),
});
export type DraftContent = z.infer<typeof DraftContentSchema>;

export const EMPTY_DRAFT_CONTENT: DraftContent = {
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  body: "",
  attachments: [],
};

/** Nothing written: closing it discards it rather than keeping an empty draft. */
export function isDraftEmpty(c: DraftContent): boolean {
  return (
    c.to.trim() === "" &&
    c.cc.trim() === "" &&
    c.bcc.trim() === "" &&
    c.subject.trim() === "" &&
    c.body.trim() === "" &&
    c.attachments.length === 0
  );
}

/**
 * Where a draft is:
 * - `editing` — being written (its last send may have failed: `sendError`);
 * - `queued` — in the outbox until `sendAt` (Undo takes it back to `editing`);
 * - `sending` — handed to the provider (too late to undo);
 * - `sent` — gone; its message arrives in the thread through the change sync.
 */
export const DRAFT_STATES = ["editing", "queued", "sending", "sent"] as const;
export type DraftState = (typeof DRAFT_STATES)[number];

/** One draft as the editor reads it (`mail.draft`). */
export const MailDraftSchema = z.object({
  id: mailDraftIdKind.schema,
  kind: z.enum(DRAFT_KINDS),
  /** The thread it answers (reply, reply all, forward) or was saved into; null for a new message never saved. */
  threadId: z.string().nullable(),
  /** Who a reply goes to and when they wrote (the reply box's header); null for a new message or a forward. */
  replyingTo: z.object({ name: z.string(), date: z.string() }).nullable(),
  state: z.enum(DRAFT_STATES),
  /** ISO instant the queued send goes at. */
  sendAt: z.string().nullable(),
  /** Why the last send did not go, in words; null when none failed. */
  sendError: z.string().nullable(),
  content: DraftContentSchema,
});
export type MailDraft = z.infer<typeof MailDraftSchema>;

/** Why a draft is not answered: `missing` — discarded, sent and cleared, or never started. */
export const MAIL_DRAFT_REFUSALS = ["missing"] as const;

/** One draft, pushed on every change to its row (a save, a send queued or undone, a send landed or failed). */
export const mailDraft = liveValue("mail.draft", {
  schema: MailDraftSchema,
  params: ["id"],
  refusals: MAIL_DRAFT_REFUSALS,
});

/** How a draft starts: blank, as an answer to (or forward of) a message, or as the continuation of a draft message a thread holds. */
export const DraftStartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }),
  z.object({
    kind: z.enum(["reply", "reply-all", "forward"]),
    threadId: z.string().min(1),
    messageId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("continue"),
    threadId: z.string().min(1),
    messageId: z.string().min(1),
  }),
]);
export type DraftStart = z.infer<typeof DraftStartSchema>;

/**
 * Starts a draft under the browser's id (idempotent: a second call answers
 * the draft as it is). `continue` adopts a draft message the provider holds
 * (made here or elsewhere) — answering the local draft already holding it,
 * whose id may differ from the one sent. Answers the draft as saved.
 */
export const startMailDraft = defineEndpoint({
  route: "POST /api/mail/drafts",
  body: z.object({ id: mailDraftIdKind.schema, start: DraftStartSchema }),
  response: MailDraftSchema,
});

/** Saves the editor's content (409 once it is queued or sent: the editor reopens it with Undo). */
export const saveMailDraft = defineEndpoint({
  route: "PUT /api/mail/drafts/:id",
  body: z.object({ content: DraftContentSchema }),
});

/**
 * Sends: saves `content`, then queues the draft in the outbox for the
 * undo-send delay (Settings → Config, `mail-compose`). A draft with no
 * recipient, an address that is not one, or files over the size limit is
 * refused (400, the reason in words) and stays as it was.
 */
export const sendMailDraft = defineEndpoint({
  route: "POST /api/mail/drafts/:id/send",
  body: z.object({ content: DraftContentSchema }),
  response: z.object({ sendAt: z.string() }),
});

/** Takes a queued send back to the draft, while it has not gone; `too-late` once it is being sent or sent. */
export const undoSendMailDraft = defineEndpoint({
  route: "POST /api/mail/drafts/:id/undo-send",
  response: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("reopened") }),
    z.object({ kind: z.literal("too-late") }),
  ]),
});

/** Discards a draft: its row goes now, its provider draft is deleted by the mirror job. */
export const discardMailDraft = defineEndpoint({
  route: "DELETE /api/mail/drafts/:id",
});
