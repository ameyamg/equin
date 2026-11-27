// Reading a message's headers (RFC 2047 encoded words, RFC 5322 address
// lists): what a provider handed back raw (Gmail's format=metadata / full)
// and what parseMimeMessage reads from bytes.

/** An address with its display name (null when the header gave none). */
export type ParsedAddress = { name: string | null; address: string };

/** A decoder for `charset`, or null when no decoder knows it. */
export function decoderFor(charset: string): TextDecoder | null {
  try {
    return new TextDecoder(charset.trim().toLowerCase());
  } catch (err) {
    if (err instanceof RangeError) return null;
    throw err;
  }
}

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

function wordBytes(encoding: string, text: string): Uint8Array {
  if (encoding.toUpperCase() === "B") {
    return Uint8Array.from(atob(text.replace(/[^A-Za-z0-9+/=]/g, "")), (c) =>
      c.charCodeAt(0),
    );
  }
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "_") out.push(0x20);
    else if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(c.charCodeAt(0));
  }
  return Uint8Array.from(out);
}

/**
 * Decodes RFC 2047 encoded words (`=?UTF-8?B?…?=`). Whitespace between two
 * adjacent encoded words is dropped (§6.2), and adjacent words of one charset
 * are decoded as one byte run — a mailer may split a multi-byte character
 * across two words. A run in a charset nobody decodes, or malformed base64,
 * stays as written.
 */
export function decodeEncodedWords(value: string): string {
  let out = "";
  let at = 0;
  let run: { charset: string; bytes: Uint8Array[]; raw: string } | null = null;
  const flush = () => {
    if (run === null) return;
    const decoder = decoderFor(run.charset);
    const total = run.bytes.reduce((n, b) => n + b.byteLength, 0);
    const joined = new Uint8Array(total);
    let off = 0;
    for (const b of run.bytes) {
      joined.set(b, off);
      off += b.byteLength;
    }
    out += decoder ? decoder.decode(joined) : run.raw;
    run = null;
  };
  for (const m of value.matchAll(ENCODED_WORD)) {
    const between = value.slice(at, m.index);
    const charset = m[1]!.split("*")[0]!.toLowerCase();
    let bytes: Uint8Array | null;
    try {
      bytes = wordBytes(m[2]!, m[3]!);
    } catch (err) {
      // atob on malformed base64.
      if (!(err instanceof DOMException)) throw err;
      bytes = null;
    }
    const adjacent = run !== null && /^\s*$/.test(between);
    if (adjacent && bytes !== null && run!.charset === charset) {
      run!.bytes.push(bytes);
      run!.raw += m[0];
    } else {
      flush();
      // Whitespace between two encoded words is dropped; other text is kept.
      out += adjacent ? "" : between;
      if (bytes === null) out += m[0];
      else run = { charset, bytes: [bytes], raw: m[0] };
    }
    at = m.index + m[0].length;
  }
  flush();
  return out + value.slice(at);
}

/** Splits on `sep` outside quotes, angle brackets and comments. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = 0;
  let paren = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && quoted) {
      cur += c + (s[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "<") angle++;
    else if (!quoted && c === ">") angle = Math.max(0, angle - 1);
    else if (!quoted && c === "(") paren++;
    else if (!quoted && c === ")") paren = Math.max(0, paren - 1);
    if (c === sep && !quoted && angle === 0 && paren === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function unquote(name: string): string {
  const t = name.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return t;
}

/** One mailbox (`Name <a@b>`, `a@b`, `a@b (Name)`), or null when it names no address. */
export function parseMailbox(raw: string): ParsedAddress | null {
  const s = raw.trim();
  if (s === "") return null;
  const angle = /^(.*)<([^<>]+)>\s*(?:\(.*\))?$/s.exec(s);
  if (angle) {
    const address = angle[2]!.trim();
    if (!address.includes("@")) return null;
    const name = decodeEncodedWords(unquote(angle[1]!)).trim();
    return { name: name === "" ? null : name, address };
  }
  const comment = /^([^\s()]+)\s*\((.*)\)$/s.exec(s);
  if (comment && comment[1]!.includes("@")) {
    const name = decodeEncodedWords(comment[2]!).trim();
    return { name: name === "" ? null : name, address: comment[1]! };
  }
  return s.includes("@") && !/\s/.test(s) ? { name: null, address: s } : null;
}

/**
 * An address list (To, Cc, …). A group (`team: a@b, c@d;`) contributes its
 * members; an empty one (`undisclosed-recipients:;`) none.
 */
export function parseAddressList(raw: string | null): ParsedAddress[] {
  if (raw === null) return [];
  const out: ParsedAddress[] = [];
  for (const part of splitTop(raw, ",")) {
    // `group: a@b` — the group name goes, the member stays.
    const colon = splitTop(part, ":");
    const member = (colon.length > 1 ? colon.slice(1).join(":") : part).replace(
      /;\s*$/,
      "",
    );
    const p = parseMailbox(member);
    if (p) out.push(p);
  }
  return out;
}
