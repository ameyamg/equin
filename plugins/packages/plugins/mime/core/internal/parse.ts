import {
  decodeEncodedWords,
  decoderFor,
  parseAddressList,
  parseMailbox,
  type ParsedAddress,
} from "./headers";

// Reading an RFC 5322 / 2045 message from its bytes — the inverse of
// buildMimeMessage: the headers a mail client shows and threads by, the text
// and HTML bodies decoded to strings, and every other leaf part as an
// attachment (its bytes decoded). Plain JS, on every host.

/** One part that is not a body: an attachment, or an inline image (`Content-ID`). */
export type ParsedMimeAttachment = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  /** `Content-ID` without its angle brackets, or null. */
  contentId: string | null;
  /** `Content-Disposition: inline` (or none) with a Content-ID: shown in the body. */
  inline: boolean;
};

/** A decoded text body, and the charset it declared when no decoder knows it (else null). */
export type ParsedMimeBody = { content: string; unknownCharset: string | null };

export type ParsedMimeMessage = {
  from: ParsedAddress | null;
  to: ParsedAddress[];
  cc: ParsedAddress[];
  bcc: ParsedAddress[];
  replyTo: ParsedAddress[];
  subject: string;
  /** The Date header, or null when absent or unreadable. */
  date: Date | null;
  /** Angle brackets included, as every Message-ID header below. */
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** The first text/plain body part, decoded; null when none. */
  text: ParsedMimeBody | null;
  html: ParsedMimeBody | null;
  attachments: ParsedMimeAttachment[];
};

type Part = { headers: Map<string, string>; body: string };

const latin1 = new TextDecoder("latin1");

/** A header block (unfolded) as lower-cased name → its first value. */
function readHeaders(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!out.has(name)) out.set(name, line.slice(colon + 1).trim());
  }
  return out;
}

/** A part's header block and body; the text is the bytes read as latin1, one char per byte. */
function splitPart(raw: string): Part {
  const m = /\r?\n\r?\n/.exec(raw);
  if (m === null) return { headers: readHeaders(raw), body: "" };
  return {
    headers: readHeaders(raw.slice(0, m.index)),
    body: raw.slice(m.index + m[0].length),
  };
}

/** A header's main value (`text/plain` of `text/plain; charset=…`), lower-cased. */
function mainValue(value: string | undefined): string {
  return (value ?? "").split(";")[0]!.trim().toLowerCase();
}

/** A parameter of a structured header: quoted, bare, or RFC 2231 (`name*=UTF-8''…`). */
function param(value: string | undefined, name: string): string | null {
  if (value === undefined) return null;
  const extended = new RegExp(
    `;\\s*${name}\\*=\\s*([^']*)'[^']*'([^;\\s]+)`,
    "i",
  ).exec(value);
  if (extended) {
    const bytes: number[] = [];
    const raw = extended[2]!;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === "%" && /^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) {
        bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
        i += 2;
      } else bytes.push(raw.charCodeAt(i) & 0xff);
    }
    const decoder = decoderFor(extended[1]! || "utf-8") ?? latin1;
    return decoder.decode(Uint8Array.from(bytes));
  }
  const plain = new RegExp(
    `;\\s*${name}=\\s*("((?:[^"\\\\]|\\\\.)*)"|[^;\\s]+)`,
    "i",
  ).exec(value);
  if (!plain) return null;
  return decodeEncodedWords(
    plain[2] !== undefined ? plain[2].replace(/\\(.)/g, "$1") : plain[1]!,
  );
}

function binary(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function decodeQuotedPrintable(s: string): Uint8Array {
  const text = s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(text.charCodeAt(i) & 0xff);
  }
  return Uint8Array.from(out);
}

/** A leaf part's body as its bytes, its transfer encoding undone. */
function bodyBytes(p: Part): Uint8Array {
  const enc = mainValue(p.headers.get("content-transfer-encoding"));
  if (enc === "base64") {
    return binary(atob(p.body.replace(/[^A-Za-z0-9+/=]/g, "")));
  }
  if (enc === "quoted-printable") return decodeQuotedPrintable(p.body);
  return binary(p.body);
}

/** The leaf parts, in order; a forwarded message (`message/rfc822`) is one leaf. */
function leaves(p: Part): Part[] {
  const type = mainValue(p.headers.get("content-type"));
  if (!type.startsWith("multipart/")) return [p];
  const boundary = param(p.headers.get("content-type"), "boundary");
  if (boundary === null) return [p];
  const delimiter = `--${boundary}`;
  const out: Part[] = [];
  const chunks = p.body.split(delimiter);
  // chunks[0] is the preamble; a chunk starting with "--" is the close.
  for (const chunk of chunks.slice(1)) {
    if (chunk.startsWith("--")) break;
    out.push(
      ...leaves(
        splitPart(chunk.replace(/^[ \t]*\r?\n/, "").replace(/\r?\n$/, "")),
      ),
    );
  }
  return out;
}

function messageIds(value: string | undefined): string[] {
  return value === undefined
    ? []
    : [...value.matchAll(/<[^<>\s]+>/g)].map((m) => m[0]);
}

/** A text part decoded, its CRLF line breaks read as `\n`. */
function textOf(p: Part): ParsedMimeBody {
  const charset = param(p.headers.get("content-type"), "charset") ?? "utf-8";
  const decoder = decoderFor(charset);
  // A charset no decoder knows: its bytes read as UTF-8 (replacement
  // characters where they are not), and the charset named so a reader can say so.
  return {
    content: (decoder ?? new TextDecoder())
      .decode(bodyBytes(p))
      .replace(/\r\n/g, "\n"),
    unknownCharset: decoder === null ? charset : null,
  };
}

/**
 * The message `mime` holds. The first text/plain and text/html leaves that
 * are not attachments are its bodies; every other leaf is an attachment.
 */
export function parseMimeMessage(mime: Uint8Array): ParsedMimeMessage {
  const parsed = splitPart(latin1.decode(mime));
  // A single-part message's body ends with the message's own line break, as
  // a multipart's part ends with the delimiter's (which `leaves` drops).
  const root = mainValue(parsed.headers.get("content-type")).startsWith(
    "multipart/",
  )
    ? parsed
    : { ...parsed, body: parsed.body.replace(/\r?\n$/, "") };
  const h = root.headers;
  let text: ParsedMimeBody | null = null;
  let html: ParsedMimeBody | null = null;
  const attachments: ParsedMimeAttachment[] = [];
  for (const leaf of leaves(root)) {
    const type = mainValue(leaf.headers.get("content-type")) || "text/plain";
    const disposition = leaf.headers.get("content-disposition");
    const attached = mainValue(disposition) === "attachment";
    const filename =
      param(disposition, "filename") ??
      param(leaf.headers.get("content-type"), "name");
    if (
      !attached &&
      filename === null &&
      type === "text/plain" &&
      text === null
    ) {
      text = textOf(leaf);
      continue;
    }
    if (
      !attached &&
      filename === null &&
      type === "text/html" &&
      html === null
    ) {
      html = textOf(leaf);
      continue;
    }
    const cid = leaf.headers.get("content-id");
    const contentId = cid === undefined ? null : cid.replace(/^<|>$/g, "");
    attachments.push({
      filename: filename ?? "",
      mimeType: type,
      bytes: bodyBytes(leaf),
      contentId,
      inline: !attached && contentId !== null,
    });
  }
  const dateHeader = h.get("date");
  const date = dateHeader === undefined ? null : new Date(dateHeader);
  const one = (name: string) => {
    const v = h.get(name);
    return v === undefined ? null : parseMailbox(v);
  };
  const list = (name: string) => parseAddressList(h.get(name) ?? null);
  return {
    from: one("from"),
    to: list("to"),
    cc: list("cc"),
    bcc: list("bcc"),
    replyTo: list("reply-to"),
    subject: decodeEncodedWords(h.get("subject") ?? ""),
    date: date === null || Number.isNaN(date.getTime()) ? null : date,
    messageId: messageIds(h.get("message-id"))[0] ?? null,
    inReplyTo: messageIds(h.get("in-reply-to"))[0] ?? null,
    references: messageIds(h.get("references")),
    text,
    html,
    attachments,
  };
}
