// What every route serving a mail's untrusted bytes answers with: no
// sniffing, and as a document, sandboxed with nothing it may load — and the
// plain-text refusal. Shared by the server's part routes and the machine's
// image proxy.

/** Every untrusted answer: no sniffing, and as a document, sandboxed with nothing it may load. */
export const UNTRUSTED_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
} as const;

export function refused(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
