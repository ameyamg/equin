import { open, rename, unlink } from "node:fs/promises";
import { stat } from "@plugins/packages/plugins/timed-fs/core";
import {
  pipeBounded,
  type AttachmentBlobsImpl,
} from "@plugins/infra/plugins/attachments/server";
import { diskPathFor, ensureAttachmentsRoot } from "./paths";

/**
 * The desktop's attachment bytes: one UUID-named file per attachment under the
 * host-global `state/attachments` data dir, the row's key being the file's
 * absolute path.
 */
export const fileBlobs: AttachmentBlobsImpl = {
  async write(id, filename, bytes, maxBytes) {
    await ensureAttachmentsRoot();
    const diskPath = diskPathFor(id, filename);
    // Streamed into a sibling temp file, renamed into place once whole: a
    // refused or cut upload leaves nothing under the attachment's name, and
    // two writes of one id (an idempotent import racing itself) each land
    // whole.
    const partial = `${diskPath}.${crypto.randomUUID()}.partial`;
    const file = await open(partial, "wx");
    let size: number;
    try {
      size = await pipeBounded(bytes, maxBytes, async (chunk) => {
        // A write may take less than it is handed: write the rest.
        let at = 0;
        while (at < chunk.byteLength) {
          const { bytesWritten } = await file.write(chunk, at);
          at += bytesWritten;
        }
      });
    } catch (err) {
      await file.close();
      await unlink(partial);
      throw err;
    }
    await file.close();
    await rename(partial, diskPath);
    return { key: diskPath, size };
  },
  async read(diskPath) {
    try {
      await stat(diskPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      return null;
    }
    return Bun.file(diskPath);
  },
  async delete(diskPath) {
    // eslint-disable-next-line promise-safety/no-absorbed-failure -- best-effort disk cleanup after the DB row is already deleted; the awaited result is discarded, so undefined only prevents an unhandled rejection, never feeds a decision
    await unlink(diskPath).catch(() => undefined);
  },
  async ensureRoot() {
    await ensureAttachmentsRoot();
  },
};
