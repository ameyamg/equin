import {
  base64Lines,
  encodeQuotedPrintable,
  encodeWord,
  filenameParams,
  foldHeader,
  formatAddress,
} from "./encode";

export type MimeAddress = { name: string | null; address: string };

export type MimeAttachment = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
};

/** One message to build. Every header the app writes; nothing is added on its own but MIME-Version, Date and the body's. */
export type MimeMessage = {
  from: MimeAddress;
  to: readonly MimeAddress[];
  cc?: readonly MimeAddress[];
  /** Written as a header: a provider that sends from the bytes (Gmail) delivers to it and strips it. */
  bcc?: readonly MimeAddress[];
  subject: string;
  date: Date;
  /** `<id@domain>`, angle brackets included. */
  messageId: string;
  /** The message replied to (its Message-ID), or null. */
  inReplyTo?: string | null;
  /** The thread's Message-IDs, oldest first. */
  references?: readonly string[];
  text: string;
  /** An HTML alternative of `text`, or null for text alone. */
  html?: string | null;
  attachments?: readonly MimeAttachment[];
};

const MESSAGE_ID = /^<[^<>\s@]+@[^<>\s@]+>$/;

/** A fresh `<random@domain>` Message-ID (122 random bits). */
export function newMessageId(domain: string): string {
  if (!/^[A-Za-z0-9.-]+$/.test(domain)) {
    throw new Error(`mime: ${JSON.stringify(domain)} is not a domain`);
  }
  return `<${crypto.randomUUID()}@${domain}>`;
}

function boundary(): string {
  return `=_equin_${crypto.randomUUID().replace(/-/g, "")}`;
}

/** RFC 5322 date-time in UTC: `Thu, 26 Nov 2026 20:15:00 +0000`. */
function rfc5322Date(d: Date): string {
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mon = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][d.getUTCMonth()];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${day}, ${p(d.getUTCDate())} ${mon} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

function assertMessageId(what: string, id: string): void {
  if (!MESSAGE_ID.test(id)) {
    throw new Error(`mime: ${what} ${JSON.stringify(id)} is not a Message-ID`);
  }
}

/** A part: its headers and its encoded body, as lines. */
type Part = { headers: string[]; body: string };

function textPart(subtype: "plain" | "html", content: string): Part {
  return {
    headers: [
      `Content-Type: text/${subtype}; charset="UTF-8"`,
      "Content-Transfer-Encoding: quoted-printable",
    ],
    body: encodeQuotedPrintable(content),
  };
}

function multipart(subtype: "alternative" | "mixed", parts: Part[]): Part {
  const b = boundary();
  const body = parts
    .map((p) => `--${b}\r\n${p.headers.join("\r\n")}\r\n\r\n${p.body}\r\n`)
    .join("");
  return {
    headers: [`Content-Type: multipart/${subtype}; boundary="${b}"`],
    body: `${body}--${b}--`,
  };
}

function attachmentPart(a: MimeAttachment): Part {
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(a.mimeType)) {
    throw new Error(`mime: ${JSON.stringify(a.mimeType)} is not a MIME type`);
  }
  return {
    headers: [
      foldHeader(
        "Content-Type",
        `${a.mimeType}; ${filenameParams("name", a.filename)}`,
      ),
      foldHeader(
        "Content-Disposition",
        `attachment; ${filenameParams("filename", a.filename)}`,
      ),
      "Content-Transfer-Encoding: base64",
    ],
    body: base64Lines(a.bytes),
  };
}

/**
 * The message as RFC 5322 bytes: the headers (each folded, non-ASCII as
 * encoded-words), then the body — text/plain alone, or with its HTML as
 * multipart/alternative — wrapped in multipart/mixed with the attachments
 * when there are any. CRLF line breaks throughout.
 */
export function buildMimeMessage(m: MimeMessage): Uint8Array {
  assertMessageId("Message-ID", m.messageId);
  if (m.inReplyTo) assertMessageId("In-Reply-To", m.inReplyTo);
  for (const r of m.references ?? []) assertMessageId("References", r);
  const list = (as: readonly MimeAddress[]) => as.map(formatAddress).join(", ");
  const headers = [
    foldHeader("From", formatAddress(m.from)),
    ...(m.to.length ? [foldHeader("To", list(m.to))] : []),
    ...(m.cc?.length ? [foldHeader("Cc", list(m.cc))] : []),
    ...(m.bcc?.length ? [foldHeader("Bcc", list(m.bcc))] : []),
    foldHeader("Subject", encodeWord(m.subject.replace(/[\r\n]+/g, " "))),
    `Date: ${rfc5322Date(m.date)}`,
    `Message-ID: ${m.messageId}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references?.length
      ? [foldHeader("References", m.references.join(" "))]
      : []),
    "MIME-Version: 1.0",
  ];
  let body: Part = m.html
    ? multipart("alternative", [
        textPart("plain", m.text),
        textPart("html", m.html),
      ])
    : textPart("plain", m.text);
  if (m.attachments?.length) {
    body = multipart("mixed", [body, ...m.attachments.map(attachmentPart)]);
  }
  const text = `${[...headers, ...body.headers].join("\r\n")}\r\n\r\n${body.body}\r\n`;
  return new TextEncoder().encode(text);
}
