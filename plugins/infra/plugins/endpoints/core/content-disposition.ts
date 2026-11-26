/**
 * How a browser should treat a served file: shown in place (`inline`) or
 * saved (`attachment`).
 */
export type DispositionType = "inline" | "attachment";

/**
 * The `Content-Disposition` header for a served file, as an entry to spread
 * into a response's headers: `{ ...contentDisposition("inline", name) }`.
 *
 * The one place this header is spelled (lint `endpoints/no-raw-content-disposition`):
 * a header value must be a latin-1 ByteString, so a raw filename with an em
 * dash, an accent, an emoji or CJK makes `new Response` throw ("Header
 * 'Content-Disposition' has invalid value" — report-1795700584-vvbscp). Per
 * RFC 6266 §4.3 / RFC 8187 it carries both:
 *
 * - `filename="…"` — a printable-ASCII fallback for a reader that ignores
 *   `filename*`: every other character becomes `_`, `"` and `\` are
 *   backslash-escaped (RFC 9110 quoted-string);
 * - `filename*=UTF-8''…` — the exact name, percent-encoded (RFC 8187
 *   attr-char: `encodeURIComponent` minus `'()*`, which it leaves bare).
 *
 * A browser that knows `filename*` (all current ones) saves under the exact
 * name. Control characters (a newline would split the header) never reach
 * either form raw.
 */
export function contentDisposition(
  type: DispositionType,
  filename: string,
): { "Content-Disposition": string } {
  return {
    "Content-Disposition": `${type}; filename="${asciiFallback(filename)}"; filename*=UTF-8''${rfc8187Encode(filename)}`,
  };
}

function asciiFallback(filename: string): string {
  return filename
    .replace(/[^\x20-\x7e]/gu, "_")
    .replace(/["\\]/g, (c) => `\\${c}`);
}

/**
 * A lone UTF-16 surrogate (a name cut mid-emoji) has no UTF-8 spelling and
 * makes `encodeURIComponent` throw: it becomes U+FFFD, as a UTF-8 decoder
 * would read it. (`String.prototype.toWellFormed` is newer than the browser
 * floor; this core runs in a browser host too.)
 */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function rfc8187Encode(filename: string): string {
  return encodeURIComponent(filename.replace(LONE_SURROGATE, "\uFFFD")).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
