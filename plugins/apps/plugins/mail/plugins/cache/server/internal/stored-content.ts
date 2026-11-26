import { z } from "zod";
import {
  messageId,
  threadId,
  threadVersion,
  type MailboxId,
  type ThreadContent,
} from "@plugins/apps/plugins/mail/plugins/provider/core";

// A ThreadContent as the cache stores it in jsonb (`mail_thread_bodies`):
// dates as ISO text, every other field as the contract has it. A load-order
// leaf (tables.ts reads it).

const ParticipantSchema = z.object({
  name: z.string().nullable(),
  address: z.string(),
});

const BodySchema = z
  .object({ content: z.string(), unknownCharset: z.string().nullable() })
  .nullable();

export const StoredContentSchema = z.object({
  id: z.string(),
  version: z.string(),
  messages: z.array(
    z.object({
      id: z.string(),
      from: ParticipantSchema.nullable(),
      to: z.array(ParticipantSchema),
      cc: z.array(ParticipantSchema),
      bcc: z.array(ParticipantSchema),
      replyTo: z.array(ParticipantSchema),
      subject: z.string(),
      date: z.iso.datetime(),
      rfc822MessageId: z.string().nullable(),
      inReplyTo: z.string().nullable(),
      references: z.array(z.string()),
      mailboxes: z.array(z.string()),
      unread: z.boolean(),
      starred: z.boolean(),
      isDraft: z.boolean(),
      text: BodySchema,
      html: BodySchema,
      attachments: z.array(
        z.object({
          ref: z.object({
            messageId: z.string(),
            partId: z.string(),
            handle: z.string(),
          }),
          filename: z.string(),
          mimeType: z.string(),
          size: z.number(),
          contentId: z.string().nullable(),
          inline: z.boolean(),
        }),
      ),
    }),
  ),
});
export type StoredContent = z.infer<typeof StoredContentSchema>;

export function storeContent(c: ThreadContent): StoredContent {
  return {
    ...c,
    messages: c.messages.map((m) => ({ ...m, date: m.date.toISOString() })),
  };
}

export function loadContent(c: StoredContent): ThreadContent {
  return {
    id: threadId(c.id),
    version: threadVersion(c.version),
    messages: c.messages.map((m) => ({
      ...m,
      id: messageId(m.id),
      date: new Date(m.date),
      mailboxes: m.mailboxes as MailboxId[],
      attachments: m.attachments.map((a) => ({
        ...a,
        ref: { ...a.ref, messageId: messageId(a.ref.messageId) },
      })),
    })),
  };
}

/**
 * What a stored body weighs against the byte budget: its text and HTML
 * (UTF-16 code units ≈ bytes for the mostly-ASCII mail is), the rest
 * negligible beside them.
 */
export function contentBytes(c: ThreadContent): number {
  let n = 0;
  for (const m of c.messages) {
    n += (m.text?.content.length ?? 0) + (m.html?.content.length ?? 0) + 512;
  }
  return n;
}
