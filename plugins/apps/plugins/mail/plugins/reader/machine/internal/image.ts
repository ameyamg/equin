import {
  isUnreachableError,
  safeFetch,
  SsrfError,
} from "@plugins/infra/plugins/safe-fetch/server";
import { refused, UNTRUSTED_HEADERS, verifyMail } from "../../server";

// The image proxy: a remote image of a mail body, fetched by THIS computer's
// server (SSRF-guarded, `safeFetch` resolves through node:dns), so the sender
// never sees the reader's address. A host without the computer has no such
// fetch: the endpoint is declared needsMachine.

/** A remote image larger than this is not proxied. */
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** How long the proxy waits on a sender's server. */
const IMAGE_TIMEOUT_MS = 15_000;

// ── the image proxy ──────────────────────────────────────────────────────

/** `GET /api/mail/image/:sig?u=` — a remote image the server signed, fetched SSRF-guarded. */
export async function handleImage(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const url = new URL(req.url).searchParams.get("u");
  const sig = params.sig ?? "";
  if (url === null || !(await verifyMail("image", [url], sig))) {
    return refused(403, "not an image this server proxies");
  }
  let res: Response;
  try {
    res = await safeFetch(url, {
      timeoutMs: IMAGE_TIMEOUT_MS,
      headers: { accept: "image/*" },
    });
  } catch (err) {
    if (err instanceof SsrfError) return refused(403, err.message);
    if (isUnreachableError(err)) return refused(502, String(err));
    throw err;
  }
  if (!res.ok) {
    await res.body?.cancel();
    return refused(502, `the image's server answered ${res.status}`);
  }
  const type = res.headers.get("content-type") ?? "";
  if (!/^image\//i.test(type)) {
    await res.body?.cancel();
    return refused(415, `not an image: ${type || "no type"}`);
  }
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > IMAGE_MAX_BYTES) {
    await res.body?.cancel();
    return refused(413, "image too large");
  }
  let bytes: Uint8Array<ArrayBuffer> | null;
  try {
    bytes = await readBounded(res, IMAGE_MAX_BYTES);
  } catch (err) {
    // The sender's server cut or stalled the body: a network peer's failure.
    if (isUnreachableError(err) || isAbort(err)) {
      return refused(502, String(err));
    }
    throw err;
  }
  if (bytes === null) return refused(413, "image too large");
  return new Response(bytes, {
    headers: {
      ...UNTRUSTED_HEADERS,
      "content-type": type,
      // The reader's browser keeps it; nothing about the reader goes back.
      "cache-control": "private, max-age=86400",
      "referrer-policy": "no-referrer",
    },
  });
}

function isAbort(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

/** The body, read as it arrives and dropped past `max` (a missing or false length is no bound). */
async function readBounded(
  res: Response,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = res.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
