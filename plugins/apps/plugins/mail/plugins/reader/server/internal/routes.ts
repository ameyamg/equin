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
  mailCache,
  MailThreadUnavailableError,
} from "@plugins/apps/plugins/mail/plugins/cache/server";
import { verifyMail } from "./sign";
import { refused, UNTRUSTED_HEADERS } from "./untrusted";

// The routes the reader loads mail through (core/internal/endpoints.ts).
// Every answer is untrusted bytes served on the app's origin, so none may be
// a document that runs there: each carries `nosniff`, and a type a browser
// would render as a page (HTML, SVG, XML, anything not on the inline list)
// is served as a download or under a `sandbox` policy.

/** Types opened in a tab as themselves; anything else is downloaded. */
const INLINE_TYPES =
  /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf|text\/plain|audio\/[\w.+-]+|video\/[\w.+-]+)$/i;

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
 * attachments sweep — the next open fetches it again. Throws the cache's
 * `MailThreadUnavailableError` when the provider cannot answer.
 */
export async function readPart(
  threadId: string,
  messageId: string,
  partId: string,
): Promise<{ bytes: Uint8Array; filename: string; mime: string }> {
  const id = await partUuid([threadId, messageId, partId]);
  const held = await getAttachment(id);
  if (held !== null) {
    return {
      bytes: await readAttachmentBytes(id),
      filename: held.filename,
      mime: held.mime,
    };
  }
  const { meta, bytes } = await mailCache.attachment(
    threadId,
    messageId,
    partId,
  );
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

/** {@link readPart}, a provider that cannot answer as the route's refusal. */
async function partBytes(
  threadId: string,
  messageId: string,
  partId: string,
): Promise<{ bytes: Uint8Array; filename: string; mime: string } | Response> {
  try {
    return await readPart(threadId, messageId, partId);
  } catch (err) {
    if (err instanceof MailThreadUnavailableError) {
      return refused(err.reason === "gone" ? 404 : 503, err.message);
    }
    throw err;
  }
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
