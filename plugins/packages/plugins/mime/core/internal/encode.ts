// The encodings a message's headers and bodies need (RFC 2045, 2047, 2231,
// 5322), in plain JS so every host builds the same bytes.

const utf8 = new TextEncoder();

/** Printable ASCII and space: what a header may carry as is. */
const PLAIN_HEADER = /^[\x20-\x7e]*$/;

/** Bytes as base64 (no line breaks). */
export function base64(bytes: Uint8Array): string {
  let out = "";
  // btoa takes a binary string; build it in slices so a large attachment
  // never makes one giant argument list.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

/** Base64 broken into lines of 76 characters (RFC 2045 §6.8), CRLF-joined. */
export function base64Lines(bytes: Uint8Array): string {
  const b = base64(bytes);
  const lines: string[] = [];
  for (let i = 0; i < b.length; i += 76) lines.push(b.slice(i, i + 76));
  return lines.join("\r\n");
}

/**
 * A header phrase or text as RFC 2047 encoded-words when it is not plain
 * ASCII (or could be read as one already): `=?UTF-8?B?…?=` words of at most
 * 75 characters each, split between code points (never inside a UTF-8
 * sequence), space-separated so the header folds between them.
 */
export function encodeWord(text: string): string {
  if (PLAIN_HEADER.test(text) && !text.includes("=?")) return text;
  const words: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  // 45 bytes → 60 base64 characters, + "=?UTF-8?B?" and "?=" = 72 ≤ 75.
  for (const ch of text) {
    const n = utf8.encode(ch).length;
    if (chunkBytes + n > 45) {
      words.push(chunk);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += ch;
    chunkBytes += n;
  }
  if (chunk !== "") words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${base64(utf8.encode(w))}?=`).join(" ");
}

/** RFC 5322 `specials`: a display name holding one must be quoted. */
const SPECIALS = /[()<>[\]:;@\\,."]/;

/** An address as a header writes it: `Name <a@b>`, the name quoted or encoded as it needs. */
export function formatAddress(a: {
  name: string | null;
  address: string;
}): string {
  const address = a.address.trim();
  // ASCII only: an internationalised address needs SMTPUTF8, not written here.
  if (
    !/^[\x21-\x7e]+$/.test(address) ||
    !/^[^\s<>@"]+@[^\s<>@"]+$/.test(address)
  ) {
    throw new Error(
      `mime: ${JSON.stringify(a.address)} is not an email address`,
    );
  }
  const name = a.name?.replace(/[\r\n]+/g, " ").trim() ?? "";
  if (name === "") return address;
  let phrase: string;
  if (!PLAIN_HEADER.test(name) || name.includes("=?"))
    phrase = encodeWord(name);
  else if (SPECIALS.test(name))
    phrase = `"${name.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
  else phrase = name;
  return `${phrase} <${address}>`;
}

/**
 * One header line, folded at whitespace to lines of at most 78 characters
 * (RFC 5322 §2.2.3); a word longer than that is left whole (allowed up to
 * 998). Throws on a line break in the value: a header can never be injected.
 */
export function foldHeader(name: string, value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`mime: the ${name} header holds a line break`);
  }
  const words = value.split(" ");
  const lines: string[] = [];
  let line = `${name}:`;
  for (const w of words) {
    if (line.length + 1 + w.length > 78 && line.trim() !== `${name}:`) {
      lines.push(line);
      line = ` ${w}`;
    } else {
      line += ` ${w}`;
    }
  }
  lines.push(line);
  return lines.join("\r\n");
}

/**
 * Text as quoted-printable UTF-8 (RFC 2045 §6.7): CRLF line breaks, lines of
 * at most 76 characters with soft breaks, `=` and every byte outside
 * printable ASCII escaped, a space or tab before a line end escaped too.
 */
export function encodeQuotedPrintable(text: string): string {
  const out: string[] = [];
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const bytes = utf8.encode(rawLine);
    let line = "";
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!;
      const last = i === bytes.length - 1;
      const plain =
        (b >= 33 && b <= 126 && b !== 61) || ((b === 32 || b === 9) && !last);
      const token = plain
        ? String.fromCharCode(b)
        : `=${b.toString(16).toUpperCase().padStart(2, "0")}`;
      if (line.length + token.length > 75) {
        out.push(`${line}=`);
        line = "";
      }
      line += token;
    }
    out.push(line);
  }
  return out.join("\r\n");
}

/**
 * A `filename` parameter: quoted when it is printable ASCII, else RFC 2231's
 * `filename*=UTF-8''…` (percent-encoded) — what every current client reads.
 */
export function filenameParams(
  param: "filename" | "name",
  filename: string,
): string {
  const clean = filename.replace(/[\r\n"\\]/g, "_");
  if (PLAIN_HEADER.test(clean)) return `${param}="${clean}"`;
  const pct = [...utf8.encode(clean)]
    .map((b) =>
      /[A-Za-z0-9!#$&+.^_`|~-]/.test(String.fromCharCode(b))
        ? String.fromCharCode(b)
        : `%${b.toString(16).toUpperCase().padStart(2, "0")}`,
    )
    .join("");
  return `${param}*=UTF-8''${pct}`;
}
