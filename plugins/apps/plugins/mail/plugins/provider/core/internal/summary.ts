import type { MailboxId, MessageId, ThreadId, ThreadVersion } from "./ids";
import {
  THREAD_PARTICIPANTS_MAX,
  type Participant,
  type ThreadSummary,
} from "./model";

/** What a summary is derived from, per message. */
export type SummaryMessage = {
  id: MessageId;
  date: Date;
  from: Participant;
  to: readonly Participant[];
  subject: string;
  /** This message's own snippet (its text, cut by the provider). */
  snippet: string;
  mailboxes: readonly MailboxId[];
  unread: boolean;
  starred: boolean;
  isDraft: boolean;
  hasAttachments: boolean;
};

/**
 * A thread's summary as the contract defines it, from its messages (oldest
 * first) — for a provider that holds the messages themselves (the local
 * provider, the test fake): senders and `To` deduped in order of first
 * message, the unions and "any"s over the messages, the latest sent or
 * received message's date (a draft's only when the thread holds nothing
 * else), the latest message's snippet, mailbox ids sorted.
 */
export function deriveThreadSummary(t: {
  id: ThreadId;
  version: ThreadVersion;
  messages: readonly SummaryMessage[];
}): ThreadSummary {
  const ms = t.messages;
  if (ms.length === 0) {
    throw new Error(`mail: thread ${t.id} has no message to summarize`);
  }
  const participants: Participant[] = [];
  for (const m of ms) {
    if (participants.length >= THREAD_PARTICIPANTS_MAX) break;
    if (!participants.some((p) => p.address === m.from.address))
      participants.push(m.from);
  }
  const recipients: Participant[] = [];
  for (const m of ms)
    for (const r of m.to)
      if (
        recipients.length < THREAD_PARTICIPANTS_MAX &&
        !recipients.some((x) => x.address === r.address)
      )
        recipients.push(r);
  const boxes = new Set<MailboxId>();
  for (const m of ms) for (const b of m.mailboxes) boxes.add(b);
  const sent = ms.filter((m) => !m.isDraft);
  const dated = sent.length > 0 ? sent : ms;
  const last = ms[ms.length - 1]!;
  return {
    id: t.id,
    version: t.version,
    subject: ms[0]!.subject,
    snippet: last.snippet,
    participants,
    recipients,
    lastMessageAt: dated[dated.length - 1]!.date,
    messageCount: ms.length,
    mailboxes: [...boxes].sort(),
    unread: ms.some((m) => m.unread),
    starred: ms.some((m) => m.starred),
    hasAttachments: ms.some((m) => m.hasAttachments),
    hasDraft: ms.some((m) => m.isDraft),
    messages: ms.map((m) => ({
      id: m.id,
      date: m.date,
      mailboxes: [...m.mailboxes].sort(),
      unread: m.unread,
      starred: m.starred,
      isDraft: m.isDraft,
    })),
  };
}
