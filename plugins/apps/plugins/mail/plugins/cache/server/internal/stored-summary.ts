import { z } from "zod";
import {
  messageId,
  threadId,
  threadVersion,
  type MailboxId,
  type ThreadSummary,
} from "@plugins/apps/plugins/mail/plugins/provider/core";

// A ThreadSummary as the cache stores it in jsonb: dates as ISO text (jsonb
// has no instant), every other field as the contract has it. A load-order
// leaf (tables.ts reads it).

const ParticipantSchema = z.object({
  name: z.string().nullable(),
  address: z.string(),
});

export const StoredSummarySchema = z.object({
  id: z.string(),
  version: z.string(),
  subject: z.string(),
  snippet: z.string(),
  participants: z.array(ParticipantSchema),
  recipients: z.array(ParticipantSchema),
  lastMessageAt: z.iso.datetime(),
  messageCount: z.number().int(),
  mailboxes: z.array(z.string()),
  unread: z.boolean(),
  starred: z.boolean(),
  hasAttachments: z.boolean(),
  hasDraft: z.boolean(),
  messages: z.array(
    z.object({
      id: z.string(),
      date: z.iso.datetime(),
      mailboxes: z.array(z.string()),
      unread: z.boolean(),
      starred: z.boolean(),
      isDraft: z.boolean(),
    }),
  ),
});
export type StoredSummary = z.infer<typeof StoredSummarySchema>;

export function storeSummary(s: ThreadSummary): StoredSummary {
  return {
    ...s,
    lastMessageAt: s.lastMessageAt.toISOString(),
    messages: s.messages.map((m) => ({ ...m, date: m.date.toISOString() })),
  };
}

export function loadSummary(s: StoredSummary): ThreadSummary {
  return {
    ...s,
    id: threadId(s.id),
    version: threadVersion(s.version),
    lastMessageAt: new Date(s.lastMessageAt),
    mailboxes: s.mailboxes as MailboxId[],
    messages: s.messages.map((m) => ({
      ...m,
      id: messageId(m.id),
      date: new Date(m.date),
      mailboxes: m.mailboxes as MailboxId[],
    })),
  };
}
