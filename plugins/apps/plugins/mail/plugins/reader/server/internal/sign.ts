// The capability the mail frame's URLs carry. The frame is an opaque origin,
// so its image and inline-part requests reach the gateway anonymous: the
// routes they hit are public, and serve only what the server itself wrote
// into a body it rendered — a URL carries an HMAC of what it names, under a
// key minted per process (a restart re-renders every open body, and the
// browser keeps what it already loaded). Plain WebCrypto, on every host.

const KEY = crypto.getRandomValues(new Uint8Array(32));
let key: Promise<CryptoKey> | null = null;

function hmacKey(): Promise<CryptoKey> {
  key ??= crypto.subtle.importKey(
    "raw",
    KEY,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return key;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** What a signature is over: a kind and its parts, unambiguous (no part holds a NUL). */
function subject(kind: "image" | "inline", parts: readonly string[]): string {
  return [kind, ...parts].join("\0");
}

/** The signature of `parts` (128 bits, base64url). */
export async function signMail(
  kind: "image" | "inline",
  parts: readonly string[],
): Promise<string> {
  const mac = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(),
    new TextEncoder().encode(subject(kind, parts)),
  );
  return base64Url(new Uint8Array(mac).subarray(0, 16));
}

/** Whether `sig` is this process's signature of `parts` (compared in constant time). */
export async function verifyMail(
  kind: "image" | "inline",
  parts: readonly string[],
  sig: string,
): Promise<boolean> {
  const want = await signMail(kind, parts);
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) {
    diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}
