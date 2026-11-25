import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { stat } from "@plugins/packages/plugins/timed-fs/core";
import { AttachmentConflictError } from "@plugins/infra/plugins/attachments/server";
import { importAttachmentFile } from "@plugins/infra/plugins/attachments/machine";
import type {
  SiteFeedImportAnswer,
  SiteFeedImportQuestion,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";

/** The sha256 of a file's bytes, lowercase hex, streamed. */
export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Import the staged file `q.stagedName` (in `dir`) as attachment
 * `q.attachmentId`: its size and sha256 checked against what the computer
 * declared first, so a truncated or corrupted copy never becomes an
 * attachment. The staged file is removed once judged, whatever the verdict.
 */
export async function importStagedMedia(
  stagedPath: string,
  q: SiteFeedImportQuestion,
): Promise<SiteFeedImportAnswer> {
  let size: number;
  try {
    ({ size } = await stat(stagedPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "staged-missing", stagedName: q.stagedName };
    }
    throw err;
  }
  try {
    if (size !== q.size) {
      return { kind: "size-mismatch", expected: q.size, actual: size };
    }
    const actual = await sha256OfFile(stagedPath);
    if (actual !== q.sha256) {
      return { kind: "sha256-mismatch", expected: q.sha256, actual };
    }
    try {
      const imported = await importAttachmentFile({
        id: q.attachmentId,
        filename: q.filename,
        mime: q.mime,
        path: stagedPath,
      });
      return { kind: imported.kind, attachmentId: q.attachmentId };
    } catch (err) {
      if (err instanceof AttachmentConflictError) {
        return { kind: "conflict", message: err.message };
      }
      throw err;
    }
  } finally {
    await rm(stagedPath, { force: true });
  }
}
