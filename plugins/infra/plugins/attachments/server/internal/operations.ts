import { eq } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { _attachments } from "./tables";
import { AttachmentBlobs, AttachmentTooLargeError } from "./blobs";
import { ATTACHMENT_MAX_BYTES } from "../../core";
import type { Attachment } from "../../shared/types";

// Mint an attachment from raw bytes (server-side seeding, no HTTP round-trip).
// Stores the bytes (`AttachmentBlobs` — a file on the desktop) and inserts an
// unlinked `_attachments` row; callers
// link the returned id from their own submit path (see `Attachments.defineLink`).
export async function createAttachment(
  bytes: Uint8Array,
  filename: string,
  mime: string,
): Promise<Attachment> {
  return writeNewAttachment({
    id: crypto.randomUUID(),
    filename,
    mime,
    bytes: new Blob([bytes as BlobPart]).stream(),
    maxBytes: bytes.byteLength,
  });
}

/** An upload with no bytes (the serve route's 400). */
export class EmptyAttachmentError extends Error {
  constructor() {
    super("empty file");
    this.name = "EmptyAttachmentError";
  }
}

/**
 * {@link writeAttachment} under a freshly minted id, which no row can hold.
 * The upload route and {@link createAttachment} write through here.
 */
export async function writeNewAttachment(
  input: Omit<Parameters<typeof writeAttachment>[0], "size">,
): Promise<Attachment> {
  const att = await writeAttachment(input);
  if (att === null)
    throw new Error(`attachment id ${input.id} is already taken`);
  return att;
}

/**
 * Stream `bytes` into the blob store under `id`, then record the row —
 * `null` when a row with that id already exists (an import racing itself:
 * the same bytes under the same key). More than `maxBytes` throws
 * `AttachmentTooLargeError`, none throws {@link EmptyAttachmentError} — both
 * with nothing stored.
 */
async function writeAttachment(input: {
  id: string;
  filename: string;
  mime: string;
  bytes: ReadableStream<Uint8Array>;
  maxBytes: number;
  /** The exact size the stream must hold (an import); else refused, nothing stored. */
  size?: number;
}): Promise<Attachment | null> {
  const { id, filename, mime } = input;
  const blobs = AttachmentBlobs.get();
  const { key, size } = await blobs.write(
    id,
    filename,
    input.bytes,
    input.maxBytes,
  );
  if (size === 0) {
    await blobs.delete(key);
    throw new EmptyAttachmentError();
  }
  if (input.size !== undefined && size !== input.size) {
    await blobs.delete(key);
    throw new Error(
      `attachment ${id}: expected ${input.size} bytes, the stream held ${size}`,
    );
  }
  const [row] = await db
    .insert(_attachments)
    .values({ id, filename, mime, size, diskPath: key })
    .onConflictDoNothing({ target: _attachments.id })
    .returning();
  return row ? toAttachment(row) : null;
}

/** An import under an id that already holds other bytes. */
export class AttachmentConflictError extends Error {
  constructor(
    readonly attachmentId: string,
    readonly storedSize: number,
    readonly importedSize: number,
  ) {
    super(
      `attachment ${attachmentId} already holds ${storedSize} bytes; refusing to import ${importedSize} other bytes under its id`,
    );
    this.name = "AttachmentConflictError";
  }
}

/** An attachment id is a UUID (it names the blob's file on the desktop). */
const ATTACHMENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Write an attachment under a GIVEN id — one minted by another instance
 * (a box receiving a published file from the computer that uploaded it), so
 * the same bytes keep one id everywhere. Idempotent: an id that already holds
 * `size` bytes answers `exists` without reading `bytes` (the caller may skip
 * the transfer by checking first); one holding a different size throws
 * {@link AttachmentConflictError} — an attachment's bytes never change. The
 * stream must hold exactly `size` bytes.
 */
export async function importAttachment(input: {
  id: string;
  filename: string;
  mime: string;
  bytes: ReadableStream<Uint8Array>;
  size: number;
}): Promise<{ kind: "imported" | "exists"; attachment: Attachment }> {
  const { id, size } = input;
  if (!ATTACHMENT_ID.test(id)) {
    throw new Error(
      `not an attachment id (a lowercase UUID): ${JSON.stringify(id)}`,
    );
  }
  if (size > ATTACHMENT_MAX_BYTES)
    throw new AttachmentTooLargeError(ATTACHMENT_MAX_BYTES);
  const existing = await getAttachment(id);
  if (existing) {
    await input.bytes.cancel();
    if (existing.size !== size)
      throw new AttachmentConflictError(id, existing.size, size);
    return { kind: "exists", attachment: existing };
  }
  const attachment = await writeAttachment({ ...input, maxBytes: size });
  if (attachment) return { kind: "imported", attachment };
  // Another import of the same id recorded it first: the same bytes under the
  // same key, so its row answers for both.
  const raced = await getAttachment(id);
  if (!raced) throw new Error(`failed to record attachment ${id}`);
  if (raced.size !== size)
    throw new AttachmentConflictError(id, raced.size, size);
  return { kind: "exists", attachment: raced };
}

export async function getAttachment(id: string): Promise<Attachment | null> {
  const [row] = await db
    .select()
    .from(_attachments)
    .where(eq(_attachments.id, id))
    .limit(1);
  return row ? toAttachment(row) : null;
}

export async function deleteAttachment(id: string): Promise<boolean> {
  const [row] = await db
    .delete(_attachments)
    .where(eq(_attachments.id, id))
    .returning({ diskPath: _attachments.diskPath });
  if (!row) return false;
  // Best-effort blob cleanup, after the DB row is already deleted.
  await AttachmentBlobs.get().delete(row.diskPath);
  return true;
}

function toAttachment(row: typeof _attachments.$inferSelect): Attachment {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    diskPath: row.diskPath,
    createdAt: row.createdAt.toISOString(),
  };
}
