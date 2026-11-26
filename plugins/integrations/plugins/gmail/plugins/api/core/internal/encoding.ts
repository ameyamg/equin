// Gmail writes message bytes (`raw`, a part's `body.data`, attachment data) as
// base64url without padding. Plain JS over atob/btoa, so every host decodes
// the same way.

/** base64url (padded or not) → bytes. */
export function decodeBase64Url(data: string): Uint8Array {
  const b64 = data.replaceAll("-", "+").replaceAll("_", "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** bytes → base64url without padding. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/**
 * Google's `uploadType=multipart` body: a `multipart/related` of the JSON
 * metadata, then the RFC 2822 message as `message/rfc822` bytes. Binary-safe
 * (the message is never re-encoded), and the upload path takes up to 35 MB
 * where a JSON `raw` body tops out far lower.
 */
export function encodeRelatedUpload(
  metadata: unknown,
  message: Uint8Array,
  boundary: string,
): { contentType: string; body: Uint8Array } {
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + message.length + tail.length);
  body.set(head, 0);
  body.set(message, head.length);
  body.set(tail, head.length + message.length);
  return { contentType: `multipart/related; boundary=${boundary}`, body };
}
