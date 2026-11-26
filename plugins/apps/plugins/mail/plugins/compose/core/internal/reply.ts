import { decodeHtmlText } from "@plugins/infra/plugins/html-decode/core";
import type {
  MessageContent,
  Participant,
  SendIdentity,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import { formatAddressList } from "./addresses";
import type { DraftAttachment, DraftKind } from "./draft";

/** What a reply or forward starts as, derived from the message it answers. */
export type DraftStartContent = {
  to: string;
  cc: string;
  subject: string;
  /** What the editor opens with (a forward's forwarded message; empty for a reply). */
  body: string;
  /** The answered message's text as quoted below a reply's body when sent (null: none). */
  quote: string | null;
  inReplyTo: string | null;
  references: string[];
  attachments: DraftAttachment[];
  /** Who the reply goes to and when they wrote, for the reply box's header. */
  replyingTo: { name: string; date: string } | null;
};

/** A message's body as plain text: its text part, else its HTML with the tags taken out. */
export function plainTextOf(m: Pick<MessageContent, "text" | "html">): string {
  if (m.text !== null) return m.text.content.replace(/\r\n?/g, "\n");
  if (m.html === null) return "";
  return htmlToPlainText(m.html.content);
}

/** HTML as plain text: the tags taken out, line breaks kept at `<br>` and block ends. */
export function htmlToPlainText(html: string): string {
  return decodeHtmlText(
    html
      .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const lower = (p: Participant) => p.address.toLowerCase();

function uniqueExcept(
  list: readonly Participant[],
  except: ReadonlySet<string>,
): Participant[] {
  const seen = new Set(except);
  const out: Participant[] = [];
  for (const p of list) {
    if (seen.has(lower(p))) continue;
    seen.add(lower(p));
    out.push(p);
  }
  return out;
}

/**
 * The Message-IDs a header value holds (`<local@domain>` each), in order —
 * what a received In-Reply-To / References / Message-ID contributes to a
 * reply's threading. Anything else (a comment, a comma, an id with no `@`)
 * is left out, so a sender's odd header never makes a reply unbuildable.
 */
export function messageIdsIn(value: string | null): string[] {
  return value === null ? [] : (value.match(/<[^<>\s@]+@[^<>\s@]+>/g) ?? []);
}

/** `Re: ` / `Fwd: ` before a subject, unless it already says so. */
export function prefixedSubject(
  kind: "reply" | "forward",
  subject: string,
): string {
  const s = subject.trim();
  if (kind === "reply") return /^re:/i.test(s) ? s : `Re: ${s}`;
  return /^(fwd?|fw):/i.test(s) ? s : `Fwd: ${s}`;
}

function displayName(p: Participant | null): string {
  if (p === null) return "(unknown sender)";
  return p.name ?? p.address;
}

function longDate(d: Date): string {
  return d.toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

/** The quote a reply carries below its body: "On <date>, <who> wrote:" then the text, each line `> `. */
export function quoteOf(m: MessageContent): string {
  const who = m.from
    ? m.from.name
      ? `${m.from.name} <${m.from.address}>`
      : m.from.address
    : "someone";
  const lines = plainTextOf(m)
    .split("\n")
    .map((l) => (l === "" ? ">" : `> ${l}`));
  return `On ${longDate(m.date)}, ${who} wrote:\n${lines.join("\n")}`;
}

/**
 * How a reply, reply all or forward of `source` starts, written from `me`
 * (the account's address):
 * - reply: to the Reply-To (else the sender) — or, answering your own
 *   message, to its recipients ("Follow up");
 * - reply all: the same, plus every other To and Cc in Cc, you left out;
 * - forward: nobody yet, the message forwarded in the body, its files
 *   (not the inline images) attached by reference;
 * - every one threads: In-Reply-To the source's Message-ID, References its
 *   References plus it.
 */
export function startFrom(
  kind: Exclude<DraftKind, "new">,
  source: MessageContent,
  me: string,
  /** The thread `source` is in (what a forwarded file is fetched through). */
  threadId: string,
): DraftStartContent {
  const mine = new Set([me.toLowerCase()]);
  const own = messageIdsIn(source.rfc822MessageId)[0] ?? null;
  const references = [
    ...new Set([
      ...source.references.flatMap(messageIdsIn),
      ...(own === null ? [] : [own]),
    ]),
  ];
  const threading = { inReplyTo: own, references };
  if (kind === "forward") {
    const header = [
      "---------- Forwarded message ---------",
      `From: ${source.from ? formatAddressList([source.from]) : ""}`,
      `Date: ${longDate(source.date)}`,
      `Subject: ${source.subject}`,
      `To: ${formatAddressList(source.to)}`,
      ...(source.cc.length ? [`Cc: ${formatAddressList(source.cc)}`] : []),
    ].join("\n");
    return {
      to: "",
      cc: "",
      subject: prefixedSubject("forward", source.subject),
      body: `\n\n${header}\n\n${plainTextOf(source)}`,
      quote: null,
      ...threading,
      attachments: source.attachments
        .filter((a) => !a.inline)
        .map((a) => ({
          kind: "forwarded" as const,
          threadId,
          messageId: source.id as string,
          partId: a.ref.partId,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
        })),
      replyingTo: null,
    };
  }
  const fromMe = source.from !== null && mine.has(lower(source.from));
  const primary = fromMe
    ? source.to
    : source.replyTo.length > 0
      ? source.replyTo
      : source.from
        ? [source.from]
        : [];
  // Your own message: its recipients, you left out — unless it went to you
  // alone (a note to yourself), which a follow-up answers to you again.
  const others = uniqueExcept(primary, fromMe ? mine : new Set());
  const to = others.length > 0 ? others : uniqueExcept(primary, new Set());
  const cc =
    kind === "reply-all"
      ? uniqueExcept(
          fromMe ? source.cc : [...source.to, ...source.cc],
          new Set([...mine, ...to.map(lower)]),
        )
      : [];
  return {
    to: formatAddressList(to),
    cc: formatAddressList(cc),
    subject: prefixedSubject("reply", source.subject),
    body: "",
    quote: quoteOf(source),
    ...threading,
    attachments: [],
    replyingTo: {
      name:
        to.length === 0
          ? displayName(source.from)
          : to.map(displayName).join(", "),
      date: source.date.toISOString(),
    },
  };
}

/** A send-as identity's signature as plain text (null: none, or nothing left once the tags are out). */
export function signatureText(
  signature: SendIdentity["signature"],
): string | null {
  if (signature === null) return null;
  const text = (
    "text" in signature
      ? signature.text.replace(/\r\n?/g, "\n")
      : htmlToPlainText(signature.html)
  ).trim();
  return text === "" ? null : text;
}

/**
 * The text a message goes out with: the body as written, then the signature
 * under the `-- ` delimiter (RFC 3676) — unless the body is signed already (a
 * line that is the delimiter: a draft written in the provider's own editor
 * and adopted, whatever its signature then rendered as) — then the quote a
 * reply answers. Nothing added: the body exactly as written.
 */
export function messageText(
  body: string,
  signature: string | null,
  quote: string | null,
): string {
  const signs = signature !== null && !/(^|\n)-- \r?(\n|$)/.test(body);
  if (!signs && quote === null) return body;
  let text = body.replace(/\s+$/, "");
  if (signs)
    text = text === "" ? `-- \n${signature}` : `${text}\n\n-- \n${signature}`;
  return quote === null ? `${text}\n` : `${text}\n\n${quote}\n`;
}
