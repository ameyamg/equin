import { createHash, randomUUID } from "node:crypto";
import { open, rm } from "node:fs/promises";
import {
  AttachmentBlobs,
  AttachmentMissingError,
  getAttachment,
} from "@plugins/infra/plugins/attachments/server";
import { siteFeedsOutgoingDir } from "../../data-dirs";
import type { StagedFile } from "./publish-flow";

/**
 * Copy an attachment's bytes out of the store into a file of its own,
 * hashing them on the way — what `scp` sends and the box's import checks.
 */
export async function stageAttachment(
  attachmentId: string,
): Promise<StagedFile> {
  const att = await getAttachment(attachmentId);
  if (!att) throw new AttachmentMissingError(attachmentId, "row");
  const blob = await AttachmentBlobs.get().read(att.diskPath);
  if (blob === null) throw new AttachmentMissingError(attachmentId, "bytes");
  await siteFeedsOutgoingDir.ensure();
  const path = siteFeedsOutgoingDir.file(`${attachmentId}.${randomUUID()}`);
  const hash = createHash("sha256");
  let size = 0;
  const file = await open(path, "wx");
  try {
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      size += value.byteLength;
      let at = 0;
      while (at < value.byteLength) {
        const { bytesWritten } = await file.write(value, at);
        at += bytesWritten;
      }
    }
  } catch (err) {
    await file.close();
    await rm(path, { force: true });
    throw err;
  }
  await file.close();
  return {
    path,
    sha256: hash.digest("hex"),
    size,
    dispose: () => rm(path, { force: true }),
  };
}
