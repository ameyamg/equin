import { hostStorage } from "@plugins/framework/plugins/browser-server/plugins/host-storage/core";
import {
  pipeBounded,
  type AttachmentBlobsImpl,
} from "@plugins/infra/plugins/attachments/server";

// The bytes of every attachment, keyed by the attachment id (the key its row
// records). Held in memory and written through to the host's storage
// (`attachment-blobs`), so a persistent host keeps them across reloads; loaded
// on first use, never at module evaluation. Kept as bytes, a Blob made on each
// read: a host store never holds a Blob (WebKit's IndexedDB cannot store one).
// Bytes hold no instant: a snapshot's shift leaves them as they are.
const persisted = () =>
  hostStorage().store<Uint8Array>("attachment-blobs", {
    shiftTime: (bytes) => bytes,
  });
let held: Map<string, Uint8Array> | null = null;
const blobs = (): Map<string, Uint8Array> =>
  (held ??= new Map(persisted().loaded));

export const memoryBlobs: AttachmentBlobsImpl = {
  async write(id, _filename, bytes, maxBytes) {
    const chunks: Uint8Array[] = [];
    const size = await pipeBounded(bytes, maxBytes, (chunk) => {
      chunks.push(chunk);
    });
    const whole = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      whole.set(chunk, at);
      at += chunk.byteLength;
    }
    blobs().set(id, whole);
    persisted().put(id, whole);
    return { key: id, size };
  },
  async read(key) {
    const bytes = blobs().get(key);
    return bytes === undefined ? null : new Blob([bytes as BlobPart]);
  },
  async delete(key) {
    blobs().delete(key);
    persisted().delete(key);
  },
  async ensureRoot() {},
};
