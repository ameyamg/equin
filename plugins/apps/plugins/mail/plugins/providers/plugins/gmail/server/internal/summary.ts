import { decodeHtmlText } from "@plugins/infra/plugins/html-decode/core";
import {
  GmailResponseShapeError,
  type GmailMessage,
  type GmailThread,
} from "@plugins/integrations/plugins/gmail/plugins/api/core";
import {
  messageId,
  THREAD_PARTICIPANTS_MAX,
  threadId,
  threadVersion,
  type MailboxId,
  type Participant,
  type ThreadSummary,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import {
  decodeEncodedWords,
  parseAddressList,
  parseMailbox,
} from "@plugins/packages/plugins/mime/core";
import { header } from "./headers";
import { FLAG_LABELS, mailboxesOfLabels } from "./labels";

/** The headers a summary reads, asked for with `format=metadata`. */
export const SUMMARY_HEADERS = [
  "From",
  "To",
  "Subject",
  "Content-Type",
] as const;

const isDraft = (m: GmailMessage) => m.labelIds?.includes("DRAFT") ?? false;

/** A message's date: Gmail's `internalDate` (when it was received). Missing is an undocumented shape. */
export function messageDate(m: GmailMessage, what: string): Date {
  if (m.internalDate === undefined) {
    throw new GmailResponseShapeError(
      what,
      `message ${m.id} has no internalDate`,
    );
  }
  return new Date(m.internalDate);
}

/** Gmail's thread (format=metadata, SUMMARY_HEADERS) as a list row. */
export function summaryOfThread(t: GmailThread): ThreadSummary {
  const what = `threads.get ${t.id}`;
  const messages = t.messages;
  const participants: Participant[] = [];
  const seen = new Set<string>();
  const recipients: Participant[] = [];
  const seenTo = new Set<string>();
  const mailboxes = new Set<MailboxId>();
  for (const m of messages) {
    for (const b of mailboxesOfLabels(m.labelIds)) mailboxes.add(b);
    const from = header(m.payload?.headers, "From");
    const p = from === null ? null : parseMailbox(from);
    if (
      p &&
      !seen.has(p.address.toLowerCase()) &&
      participants.length < THREAD_PARTICIPANTS_MAX
    ) {
      seen.add(p.address.toLowerCase());
      participants.push(p);
    }
    for (const r of parseAddressList(header(m.payload?.headers, "To"))) {
      const key = r.address.toLowerCase();
      if (seenTo.has(key) || recipients.length >= THREAD_PARTICIPANTS_MAX)
        continue;
      seenTo.add(key);
      recipients.push(r);
    }
  }
  const sent = messages.filter((m) => !isDraft(m));
  const dated = sent.length > 0 ? sent : messages;
  const lastMessageAt = new Date(
    Math.max(...dated.map((m) => messageDate(m, what).getTime())),
  );
  const last = messages[messages.length - 1]!;
  const has = (label: string) =>
    messages.some((m) => m.labelIds?.includes(label) ?? false);
  return {
    id: threadId(t.id),
    version: threadVersion(t.historyId),
    subject: decodeEncodedWords(
      header(messages[0]!.payload?.headers, "Subject") ?? "",
    ),
    // Gmail's snippet is HTML-escaped text (`d&#39;avoir`): decoded once here,
    // so every reader gets plain text.
    snippet: decodeHtmlText(last.snippet ?? t.snippet ?? ""),
    participants,
    recipients,
    lastMessageAt,
    messageCount: messages.length,
    mailboxes: [...mailboxes].sort(),
    unread: has(FLAG_LABELS.unread),
    starred: has(FLAG_LABELS.starred),
    hasAttachments: messages.some((m) => {
      const type =
        m.payload?.mimeType ?? header(m.payload?.headers, "Content-Type") ?? "";
      return /^multipart\/mixed\b/i.test(type);
    }),
    hasDraft: messages.some(isDraft),
    messages: messages.map((m) => ({
      id: messageId(m.id),
      date: messageDate(m, what),
      mailboxes: mailboxesOfLabels(m.labelIds),
      unread: m.labelIds?.includes(FLAG_LABELS.unread) ?? false,
      starred: m.labelIds?.includes(FLAG_LABELS.starred) ?? false,
      isDraft: isDraft(m),
    })),
  };
}
