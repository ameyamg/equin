import { defineHostService } from "@plugins/framework/plugins/server-core/core";

/**
 * Where attachment BYTES live. The rows (`attachments`, the owner links, the
 * holds) are portable tables; the bytes are the host's: the desktop's provider
 * (`attachments#machine`) writes one UUID-named file per attachment under
 * `~/.equin/state/attachments/`, a host without a filesystem keeps them
 * in memory. A row records the key its blob was stored under (`disk_path`).
 */
export interface AttachmentBlobsImpl {
  /**
   * Store the bytes of attachment `id`, read from `bytes` as they arrive —
   * never held whole by the caller — and answer the key the row records with
   * the size written. More than `maxBytes` throws
   * {@link AttachmentTooLargeError} and leaves nothing stored. The write is
   * atomic: a reader of the key sees no bytes or all of them.
   */
  write(
    id: string,
    filename: string,
    bytes: ReadableStream<Uint8Array>,
    maxBytes: number,
  ): Promise<{ key: string; size: number }>;
  /** The bytes stored under `key`, or `null` when there are none (the file
   *  is gone) — a state the serve route answers `410` for. */
  read(key: string): Promise<Blob | null>;
  /** Drop the bytes under `key` — when this host wrote them. Best effort,
   *  after the row is already gone: bytes that are already missing are not an
   *  error, and a failure never undoes the row's deletion. A store shared
   *  between hosts whose databases fork one another (the desktop's checkouts)
   *  keeps another host's bytes: the forked row was this database's to drop,
   *  the file is still its writer's. */
  delete(key: string): Promise<void>;
  /** Make the store usable (`onReady`; before the first write too). */
  ensureRoot(): Promise<void>;
}

export const AttachmentBlobs =
  defineHostService<AttachmentBlobsImpl>("attachments.blobs");

/** An upload past the bound its caller declared (the serve route's 413). */
export class AttachmentTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`file too large (max ${maxBytes} bytes)`);
    this.name = "AttachmentTooLargeError";
  }
}

/**
 * Read `bytes` chunk by chunk into `sink`, refusing past `maxBytes` — the one
 * bounded read every blob store writes through. A reader loop, not
 * `for await`: a browser host's worker (Safari) has no async-iterable stream.
 * Answers the byte count.
 */
export async function pipeBounded(
  bytes: ReadableStream<Uint8Array>,
  maxBytes: number,
  sink: (chunk: Uint8Array) => Promise<void> | void,
): Promise<number> {
  const reader = bytes.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return size;
      size += value.byteLength;
      if (size > maxBytes) throw new AttachmentTooLargeError(maxBytes);
      await sink(value);
    }
  } catch (err) {
    await reader.cancel(err);
    throw err;
  } finally {
    reader.releaseLock();
  }
}
