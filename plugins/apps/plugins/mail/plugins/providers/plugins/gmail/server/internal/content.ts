import {
  decodeBase64Url,
  type GmailMessage,
  type GmailMessagePart,
  type GmailThread,
} from "@plugins/integrations/plugins/gmail/plugins/api/core";
import {
  messageId,
  threadId,
  threadVersion,
  type AttachmentMeta,
  type MessageBody,
  type MessageContent,
  type ThreadContent,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import {
  decodeEncodedWords,
  decoderFor,
  parseAddressList,
  parseMailbox,
} from "@plugins/packages/plugins/mime/core";
import { header } from "./headers";
import { FLAG_LABELS, mailboxesOfLabels } from "./labels";
import { messageDate } from "./summary";

const INLINE_PREFIX = "inline-part:";

/**
 * The handle of an attachment whose bytes Gmail sent inline (a small one has
 * `body.data` and no attachment id): fetching it re-reads the message.
 */
export const inlinePartHandle = (partId: string) => `${INLINE_PREFIX}${partId}`;

/** The part id an inline handle names, or null for a Gmail attachment id. */
export function inlinePartOf(handle: string): string | null {
  return handle.startsWith(INLINE_PREFIX)
    ? handle.slice(INLINE_PREFIX.length)
    : null;
}

/** The bytes of part `partId` of a `full` message, or null when it has none inline. */
export function inlinePartBytes(
  m: GmailMessage,
  partId: string,
): Uint8Array | null {
  const part = m.payload
    ? leaves(m.payload).find((p) => p.partId === partId)
    : undefined;
  return part?.body?.data === undefined
    ? null
    : decodeBase64Url(part.body.data);
}

/** Fetches a part's bytes when Gmail left them behind an attachment id (a large body). */
export type FetchPart = (
  messageId: string,
  attachmentId: string,
) => Promise<Uint8Array>;

function param(value: string | null, name: string): string | null {
  if (value === null) return null;
  const m = new RegExp(`;\\s*${name}\\*?=\\s*("([^"]*)"|[^;\\s]+)`, "i").exec(
    value,
  );
  if (!m) return null;
  return m[2] ?? m[1]!;
}

/**
 * The parts a message is made of, in order. A forwarded message
 * (`message/rfc822`) is one part — an attachment — never walked into: its
 * body and attachments are its own, not the outer message's.
 */
function leaves(part: GmailMessagePart): GmailMessagePart[] {
  if (part.mimeType.toLowerCase() === "message/rfc822") return [part];
  return part.parts && part.parts.length > 0
    ? part.parts.flatMap(leaves)
    : [part];
}

/** Several body parts of one type (a body split around inline images), read as one. */
function joinBodies(parts: MessageBody[]): MessageBody | null {
  if (parts.length === 0) return null;
  return {
    content: parts.map((b) => b.content).join("\n"),
    unknownCharset:
      parts.find((b) => b.unknownCharset !== null)?.unknownCharset ?? null,
  };
}

async function partBytes(
  m: GmailMessage,
  part: GmailMessagePart,
  fetchPart: FetchPart,
) {
  if (part.body?.data !== undefined) return decodeBase64Url(part.body.data);
  if (part.body?.attachmentId) return fetchPart(m.id, part.body.attachmentId);
  return new Uint8Array();
}

/** A text part's bytes in its declared charset (Gmail has already undone the transfer encoding). */
export function decodeText(
  bytes: Uint8Array,
  contentType: string | null,
): MessageBody {
  const charset = param(contentType, "charset") ?? "utf-8";
  const decoder = decoderFor(charset);
  if (decoder) return { content: decoder.decode(bytes), unknownCharset: null };
  return {
    content: new TextDecoder("utf-8").decode(bytes),
    unknownCharset: charset,
  };
}

function isAttachment(part: GmailMessagePart): boolean {
  const disposition = header(part.headers, "Content-Disposition") ?? "";
  return (part.filename ?? "") !== "" || /^\s*attachment\b/i.test(disposition);
}

async function messageContent(
  m: GmailMessage,
  fetchPart: FetchPart,
): Promise<MessageContent> {
  const what = `threads.get ${m.threadId}`;
  const headers = m.payload?.headers;
  const texts: MessageBody[] = [];
  const htmls: MessageBody[] = [];
  const attachments: AttachmentMeta[] = [];
  for (const part of m.payload ? leaves(m.payload) : []) {
    const type = part.mimeType.toLowerCase();
    const contentType = header(part.headers, "Content-Type");
    // The body is every text/plain and text/html part not marked as an
    // attachment, in order; every other part is an attachment (a PDF, an
    // inline image, a forwarded message, a text/calendar invite).
    const body =
      (type === "text/plain" || type === "text/html") && !isAttachment(part);
    if (body) {
      const decoded = decodeText(
        await partBytes(m, part, fetchPart),
        contentType,
      );
      (type === "text/plain" ? texts : htmls).push(decoded);
      continue;
    }
    // An empty multipart, or a part with no bytes at all, has nothing to list.
    const hasBytes =
      part.body?.attachmentId !== undefined || part.body?.data !== undefined;
    // A forwarded message is listed even when Gmail gave only its parts:
    // fetching it then fails loudly rather than it going unseen.
    if (
      type.startsWith("multipart/") ||
      (!hasBytes && type !== "message/rfc822")
    )
      continue;
    const contentId =
      header(part.headers, "Content-ID")?.trim().replace(/^<|>$/g, "") ?? null;
    const disposition = header(part.headers, "Content-Disposition") ?? "";
    attachments.push({
      ref: {
        messageId: messageId(m.id),
        partId: part.partId ?? "",
        handle: part.body?.attachmentId ?? inlinePartHandle(part.partId ?? ""),
      },
      filename: decodeEncodedWords(part.filename ?? ""),
      mimeType: part.mimeType,
      size: part.body?.size ?? 0,
      contentId,
      inline: contentId !== null && !/^\s*attachment\b/i.test(disposition),
    });
  }
  const text = joinBodies(texts);
  const html = joinBodies(htmls);
  const from = header(headers, "From");
  const references = header(headers, "References");
  return {
    id: messageId(m.id),
    from: from === null ? null : parseMailbox(from),
    to: parseAddressList(header(headers, "To")),
    cc: parseAddressList(header(headers, "Cc")),
    bcc: parseAddressList(header(headers, "Bcc")),
    replyTo: parseAddressList(header(headers, "Reply-To")),
    subject: decodeEncodedWords(header(headers, "Subject") ?? ""),
    date: messageDate(m, what),
    rfc822MessageId: header(headers, "Message-ID")?.trim() ?? null,
    inReplyTo: header(headers, "In-Reply-To")?.trim() ?? null,
    references:
      references === null
        ? []
        : references.split(/\s+/).filter((r) => r !== ""),
    mailboxes: mailboxesOfLabels(m.labelIds),
    unread: m.labelIds?.includes(FLAG_LABELS.unread) ?? false,
    starred: m.labelIds?.includes(FLAG_LABELS.starred) ?? false,
    isDraft: m.labelIds?.includes("DRAFT") ?? false,
    text,
    html,
    attachments,
  };
}

/** Gmail's thread (format=full) as the reader's content. */
export async function contentOfThread(
  t: GmailThread,
  fetchPart: FetchPart,
): Promise<ThreadContent> {
  return {
    id: threadId(t.id),
    version: threadVersion(t.historyId),
    messages: await Promise.all(
      t.messages.map((m) => messageContent(m, fetchPart)),
    ),
  };
}
