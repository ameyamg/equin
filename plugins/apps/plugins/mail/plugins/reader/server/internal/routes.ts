import {
  contentDisposition,
  rangedBlobResponse,
} from "@plugins/infra/plugins/endpoints/core";
import {
  getAttachment,
  importAttachment,
  readAttachmentBytes,
} from "@plugins/infra/plugins/attachments/server";
import {
  isUnreachableError,
  safeFetch,
  SsrfError,
} from "@plugins/infra/plugins/safe-fetch/server";
import {
  mailCache,
  MailThreadUnavailableError,
} from "@plugins/apps/plugins/mail/plugins/cache/server";
import { verifyMail } from "./sign";

// The routes the reader loads mail through (core/internal/endpoints.ts).
// Every answer is untrusted bytes served on the app's origin, so none may be
// a document that runs there: each carries `nosniff`, and a type a browser
// would render as a page (HTML, SVG, XML, anything not on the inline list)
// is served as a download or under a `sandbox` policy.

/** A remote image larger than this is not proxied. */
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** How long the proxy waits on a sender's server. */
const IMAGE_TIMEOUT_MS = 15_000;

/** Types opened in a tab as themselves; anything else is downloaded. */
const INLINE_TYPES =
  /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf|text\/plain|audio\/[\w.+-]+|video\/[\w.+-]+)$/i;

/** Every untrusted answer: no sniffing, and as a document, sandboxed with nothing it may load. */
const UNTRUSTED_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
} as const;

function refused(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

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

// ── parts and attachments, kept in infra/attachments ─────────────────────

/** A name-based (v5) UUID: the same part always imports under the same attachment id. */
async function partUuid(parts: readonly string[]): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(["mail-part", ...parts].join("\0")),
    ),
  ).subarray(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A part's bytes and description: from infra/attachments when this part was
 * imported (its id derived from the part), else from the provider through
 * the Mail cache, then imported. Unlinked, an import is reclaimed by the
 * attachments sweep — the next open fetches it again.
 */
async function partBytes(
  threadId: string,
  messageId: string,
  partId: string,
): Promise<{ bytes: Uint8Array; filename: string; mime: string } | Response> {
  const id = await partUuid([threadId, messageId, partId]);
  const held = await getAttachment(id);
  if (held !== null) {
    return {
      bytes: await readAttachmentBytes(id),
      filename: held.filename,
      mime: held.mime,
    };
  }
  let read;
  try {
    read = await mailCache.attachment(threadId, messageId, partId);
  } catch (err) {
    if (err instanceof MailThreadUnavailableError) {
      return refused(err.reason === "gone" ? 404 : 503, err.message);
    }
    throw err;
  }
  const { meta, bytes } = read;
  const filename = meta.filename || `attachment-${partId}`;
  const mime = meta.mimeType || "application/octet-stream";
  await importAttachment({
    id,
    filename,
    mime,
    bytes: new Blob([new Uint8Array(bytes)]).stream(),
    size: bytes.byteLength,
  });
  return { bytes, filename, mime };
}

/** `GET /api/mail/inline/:sig?t=&m=&p=` — an inline image the server signed, for the mail frame. */
export async function handleInline(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const parts = [q.get("t"), q.get("m"), q.get("p")];
  if (
    parts.some((p) => p === null) ||
    !(await verifyMail("inline", parts as string[], params.sig ?? ""))
  ) {
    return refused(403, "not a part this server serves");
  }
  const [t, m, p] = parts as [string, string, string];
  const got = await partBytes(t, m, p);
  if (got instanceof Response) return got;
  return new Response(new Uint8Array(got.bytes), {
    headers: {
      ...UNTRUSTED_HEADERS,
      // The frame only shows it as an image: any other type is bytes.
      "content-type": /^image\//i.test(got.mime)
        ? got.mime
        : "application/octet-stream",
      "cache-control": "private, max-age=86400",
    },
  });
}

/** `GET /api/mail/attachment/:threadId/:messageId/:partId[?download=1]` — opened in a tab or saved. */
export async function handleAttachment(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const { threadId, messageId, partId } = params;
  if (!threadId || !messageId || !partId) {
    return refused(400, "missing thread, message or part");
  }
  const got = await partBytes(threadId, messageId, partId);
  if (got instanceof Response) return got;
  const download =
    new URL(req.url).searchParams.get("download") === "1" ||
    !INLINE_TYPES.test(got.mime);
  // The browser's PDF viewer does not run in a sandboxed document; a PDF is
  // no page of the app's origin either way.
  const pdf = /^application\/pdf$/i.test(got.mime) && !download;
  return rangedBlobResponse(
    new Blob([new Uint8Array(got.bytes)]),
    req.headers,
    {
      ...(pdf ? { "x-content-type-options": "nosniff" } : UNTRUSTED_HEADERS),
      "content-type": download ? "application/octet-stream" : got.mime,
      ...contentDisposition(download ? "attachment" : "inline", got.filename),
      "cache-control": "private, max-age=3600",
    },
  );
}
