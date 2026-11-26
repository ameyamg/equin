import type {
  DraftId,
  ListCursor,
  MailboxId,
  MessageId,
  ThreadId,
  ThreadVersion,
} from "./ids";

/** An address with its display name (null when the header gave none). */
export type Participant = { name: string | null; address: string };

/** A thread row lists at most this many senders. */
export const THREAD_PARTICIPANTS_MAX = 10;

/**
 * One list row. Thread-level facts are the union / any over its messages:
 * `mailboxes` holds every mailbox one of its messages is in, `unread` is true
 * when one of them is unread.
 */
export type ThreadSummary = {
  id: ThreadId;
  /** Moves whenever the thread changes; a cached summary with this version is current. */
  version: ThreadVersion;
  /** The first message's subject. */
  subject: string;
  /** The latest message's snippet. */
  snippet: string;
  /** Senders in order of first message, deduped by address, at most THREAD_PARTICIPANTS_MAX. */
  participants: Participant[];
  /** Every `To` address, in order of first message, deduped, at most THREAD_PARTICIPANTS_MAX. */
  recipients: Participant[];
  /** The latest sent or received message's date (drafts only when the thread holds nothing else). */
  lastMessageAt: Date;
  messageCount: number;
  mailboxes: MailboxId[];
  unread: boolean;
  starred: boolean;
  /**
   * Whether a message looks like it carries attachments, from its headers
   * alone (a `multipart/mixed` body) — the content (`ThreadContent`) is exact.
   * The `hasAttachment` query column is the provider's own test, never this.
   */
  hasAttachments: boolean;
  hasDraft: boolean;
  /**
   * Each message's own facts, oldest first. A query is per message (see
   * MAIL_QUERY_COLUMNS), so whoever re-checks one over a cached thread —
   * `mailboxes`, `unread`, `starred`, `date` — evaluates it per message here,
   * never over the unions above.
   */
  messages: MessageFacts[];
};

/** What a summary knows of one message: the query columns a cache can re-check exactly. */
export type MessageFacts = {
  id: MessageId;
  date: Date;
  mailboxes: MailboxId[];
  unread: boolean;
  starred: boolean;
  isDraft: boolean;
};

/**
 * One message a list matched, naming its thread. A list answers messages, not
 * threads: a thread's place in a date-ordered list of threads is its latest
 * MATCHING message (the query is per message), and only the message order
 * says where that is — Gmail's `threads.list` orders by a thread's first
 * message, JMAP `collapseThreads` and IMAP `SEARCH` by the matching message.
 */
export type ListedMessage = { thread: ThreadId; message: MessageId };

export type MessageListPage = {
  /** Newest first by the provider's own clock (see `listOrderSlackMs`). */
  hits: ListedMessage[];
  /** Where the list goes on, or null when the provider has no more. */
  next: ListCursor | null;
};

/** Per id: found, gone (deleted since it was listed), or failed for that id alone. */
export type ThreadSummaryResult =
  | { id: ThreadId; kind: "found"; summary: ThreadSummary }
  | { id: ThreadId; kind: "gone" }
  | { id: ThreadId; kind: "failed"; error: Error };

/** How to fetch one attachment's bytes. */
export type AttachmentRef = {
  messageId: MessageId;
  /** The MIME part (stable across fetches). */
  partId: string;
  /** The provider's fetch handle (Gmail: the attachment id). */
  handle: string;
};

export type AttachmentMeta = {
  ref: AttachmentRef;
  filename: string;
  mimeType: string;
  size: number;
  /** `Content-ID` without its angle brackets, for `cid:` references. */
  contentId: string | null;
  /** Shown in the body (`Content-Disposition: inline` with a Content-ID), not listed. */
  inline: boolean;
};

/**
 * A decoded text part. `unknownCharset` names the charset the part declared
 * when no decoder knows it; the content is then its bytes read as UTF-8 (with
 * replacement characters), and the reader can say so.
 */
export type MessageBody = { content: string; unknownCharset: string | null };

export type MessageContent = {
  id: MessageId;
  from: Participant | null;
  to: Participant[];
  cc: Participant[];
  bcc: Participant[];
  replyTo: Participant[];
  subject: string;
  date: Date;
  /** The `Message-ID` header, angle brackets included, for replies (`In-Reply-To`). */
  rfc822MessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  mailboxes: MailboxId[];
  unread: boolean;
  starred: boolean;
  isDraft: boolean;
  text: MessageBody | null;
  html: MessageBody | null;
  attachments: AttachmentMeta[];
};

export type ThreadContent = {
  id: ThreadId;
  version: ThreadVersion;
  /** Oldest first. */
  messages: MessageContent[];
};

export type ThreadContentResult =
  { kind: "found"; content: ThreadContent } | { kind: "gone" };

/**
 * A message as RFC 5322 bytes, built by the app (task 7's MIME builder) — so
 * every provider takes the same message: Gmail uploads it, IMAP APPENDs it,
 * JMAP imports it as a blob, Outlook sends it as MIME.
 */
export type OutgoingMessage = {
  mime: Uint8Array;
  /** The thread a reply belongs to, or null for a new one. */
  threadId: ThreadId | null;
  /**
   * The `Message-ID` header the bytes carry (angle brackets included). It is
   * what a send whose outcome is unknown is reconciled by (`findMessage`), so
   * the bytes must carry it — asserted by the provider.
   */
  rfc822MessageId: string;
};

export type SavedDraft = {
  draftId: DraftId;
  messageId: MessageId;
  threadId: ThreadId;
};

export type SentMessage = { messageId: MessageId; threadId: ThreadId };

export type FoundMessage =
  | { kind: "found"; messageId: MessageId; threadId: ThreadId }
  | { kind: "absent" };

/** The `Message-ID` a MIME header block declares, or null. Header names are case-insensitive. */
export function mimeMessageId(mime: Uint8Array): string | null {
  // The header block ends at the first empty line; headers are ASCII.
  const text = new TextDecoder("latin1").decode(mime.subarray(0, 64 * 1024));
  const end = text.search(/\r?\n\r?\n/);
  const head = (end === -1 ? text : text.slice(0, end)).replace(
    /\r?\n[ \t]+/g,
    " ",
  );
  const m = /^message-id:[ \t]*(<[^>\r\n]+>)/im.exec(head);
  return m ? m[1]! : null;
}

/** Throws unless the bytes declare exactly `m.rfc822MessageId`. */
export function assertOutgoingMessageId(m: OutgoingMessage): void {
  const declared = mimeMessageId(m.mime);
  if (declared !== m.rfc822MessageId) {
    throw new Error(
      `mail: the outgoing message says its Message-ID is ${m.rfc822MessageId} but its headers declare ${declared ?? "none"}`,
    );
  }
}
