import { mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  AttachmentBlobs,
  AttachmentMissingError,
  getAttachment,
} from "@plugins/infra/plugins/attachments/server";
import type { MediaRef } from "@plugins/fields/plugins/media/core";
import type { SyndicatedMedia } from "../../core";
import { syndicationWorkDir } from "../../data-dirs";

/** A directory of one run's own under the syndication cache; `dispose` removes it whole. */
export async function makeWorkDir(): Promise<{
  path: string;
  dispose: () => Promise<void>;
}> {
  await syndicationWorkDir.ensure();
  const path = await mkdtemp(join(syndicationWorkDir.path, "run-"));
  return { path, dispose: () => rm(path, { recursive: true, force: true }) };
}

/** A filename safe on disk, keeping its extension: what the target sends it as stays `ref.filename`. */
function diskName(index: number, filename: string): string {
  return `${index}-${filename.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

/**
 * Copy one attachment's bytes out of the store into `dir` — the file a
 * target sends (and may re-encode). Its size is what was written.
 */
export async function stageMedia(
  ref: MediaRef,
  index: number,
  dir: string,
): Promise<SyndicatedMedia> {
  const att = await getAttachment(ref.attachmentId);
  if (!att) throw new AttachmentMissingError(ref.attachmentId, "row");
  const blob = await AttachmentBlobs.get().read(att.diskPath);
  if (blob === null)
    throw new AttachmentMissingError(ref.attachmentId, "bytes");
  const path = join(dir, diskName(index, ref.filename));
  const file = await open(path, "wx");
  let size = 0;
  try {
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      let at = 0;
      while (at < value.byteLength) {
        const { bytesWritten } = await file.write(value, at);
        at += bytesWritten;
      }
    }
  } finally {
    await file.close();
  }
  return {
    path,
    mime: ref.mime,
    filename: ref.filename,
    size,
    ...(ref.durationMs !== undefined ? { durationMs: ref.durationMs } : {}),
  };
}
