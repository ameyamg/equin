import { z } from "zod";
import { liveValue } from "@plugins/network/plugins/live/core";
import {
  cappedList,
  wholeList,
} from "@plugins/packages/plugins/list-bound/core";

const ParticipantSchema = z.object({
  name: z.string().nullable(),
  address: z.string(),
});

const AddressListSchema = wholeList(ParticipantSchema, {
  reason: "one message's own address header, as the sender wrote it",
});

/** One attachment of a message (opened through `mailAttachment` by thread, message and part). */
export const ReaderAttachmentSchema = z.object({
  partId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  /** Shown in the body (a `cid:` image), not listed with the files. */
  inline: z.boolean(),
});
export type ReaderAttachment = z.infer<typeof ReaderAttachmentSchema>;

/**
 * What an inline part (a `cid:` image) is written as in a rendered body: a
 * token, never a route — the page resolves it over its own transport (a
 * URL on a server a URL reaches, the part's bytes as a `data:` URL on an
 * in-browser one, which no URL reaches). Index into `inlineImages`.
 */
export function inlineImageToken(index: number): string {
  return `mail-inline:${index}`;
}

/** One inline part a rendered body shows, signed for the inline-part route. */
export const ReaderInlineImageSchema = z.object({
  partId: z.string(),
  /** The server's signature over thread, message and part (`mailInlinePart`'s `:sig`). */
  sig: z.string(),
});
export type ReaderInlineImage = z.infer<typeof ReaderInlineImageSchema>;

/** One message as the reader draws it. */
export const ReaderMessageSchema = z.object({
  id: z.string(),
  from: ParticipantSchema.nullable(),
  to: AddressListSchema,
  cc: AddressListSchema,
  replyTo: AddressListSchema,
  subject: z.string(),
  /** ISO instant. */
  date: z.string(),
  unread: z.boolean(),
  starred: z.boolean(),
  isDraft: z.boolean(),
  mailboxes: wholeList(z.string(), {
    reason: "the mailboxes one message is in: a handful of labels",
  }),
  /** One line of the message's text, for a folded message. */
  preview: z.string(),
  /** The plain-text body (shown when there is no HTML one). */
  text: z.string().nullable(),
  /**
   * The HTML body made safe to frame (`server/internal/render.ts`): remote
   * images through the image proxy, `cid:` images as `inlineImageToken`s the
   * page resolves, links opening a new tab, refreshes and stylesheet links
   * cut. The page frames it under its own policy (no request but those
   * routes).
   */
  html: z.string().nullable(),
  /** The inline parts `html` shows, by `inlineImageToken` index. */
  inlineImages: wholeList(ReaderInlineImageSchema, {
    reason: "the inline images of one message's body, as its parts list them",
  }),
  /** A charset no decoder knows: the body is its bytes read as UTF-8, the reader says so. */
  unknownCharset: z.string().nullable(),
  attachments: wholeList(ReaderAttachmentSchema, {
    reason: "one message's attachments, as the provider lists them",
  }),
});
export type ReaderMessage = z.infer<typeof ReaderMessageSchema>;

/** The most messages one thread holds (Gmail caps a conversation at 100). */
export const READER_MESSAGES_MAX = 500;

export const ReaderThreadSchema = z.object({
  id: z.string(),
  subject: z.string(),
  /** Every mailbox one of its messages is in (role ids `role:<role>`). */
  mailboxes: wholeList(z.string(), {
    reason: "the mailboxes one thread is in: a handful of labels",
  }),
  unread: z.boolean(),
  /** Oldest first. */
  messages: cappedList(ReaderMessageSchema, { max: READER_MESSAGES_MAX }),
});
export type ReaderThread = z.infer<typeof ReaderThreadSchema>;

/**
 * Why a thread is not answered — typed, never a server failure:
 * `gone` (deleted, or no such thread), `not-connected` (render the provider's
 * connect action), `provider-not-chosen` (several connected: draw the
 * choice), `offline-not-cached` (no current body cached and the
 * provider cannot be reached).
 */
export const MAIL_THREAD_REFUSALS = [
  "gone",
  "not-connected",
  "provider-not-chosen",
  "offline-not-cached",
] as const;
export type MailThreadRefusal = (typeof MAIL_THREAD_REFUSALS)[number];

/**
 * One thread as the reader opens it (design §4): from the cache's stored
 * body while it holds the thread's messages, else fetched from the provider
 * (the read stays loading meanwhile). Re-pushed when the change sync moves
 * the thread (read elsewhere, relabelled, a reply). Opening marks nothing read.
 */
export const mailThread = liveValue("mail.thread", {
  schema: ReaderThreadSchema,
  params: ["id"],
  refusals: MAIL_THREAD_REFUSALS,
});

/** The most inline images one message's body shows, read at once. */
export const MAIL_INLINE_IMAGES_MAX = 100;

/**
 * One message's inline images (its `cid:` parts) as `data:` URLs, in
 * `inlineImages` order — for a reader whose server no URL reaches (an
 * in-browser one, the website's demo): the body's frame is an opaque origin
 * that loads by URL, and a route would load from the PAGE's server. A reader
 * on the page's own server loads them through `mailInlinePart` instead.
 * Immutable: a message's parts never change.
 */
export const mailInlineImages = liveValue("mail.inline-images", {
  schema: z.object({
    srcs: cappedList(z.string(), { max: MAIL_INLINE_IMAGES_MAX }),
  }),
  params: ["threadId", "messageId"],
  refusals: MAIL_THREAD_REFUSALS,
});
