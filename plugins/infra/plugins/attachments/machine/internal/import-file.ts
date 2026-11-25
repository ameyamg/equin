import { stat } from "@plugins/packages/plugins/timed-fs/core";
import { importAttachment } from "@plugins/infra/plugins/attachments/server";
import type { Attachment } from "@plugins/infra/plugins/attachments/core";

/**
 * Import the file at `path` as attachment `id` (an id minted elsewhere — the
 * computer that uploaded it), streamed into the blob store. Idempotent:
 * an id already holding that file's size answers `exists` without reading it;
 * one holding another size throws `AttachmentConflictError`. The file is left
 * where it is: the caller owns it (a staging dir sweeps its own).
 */
export async function importAttachmentFile(input: {
  id: string;
  filename: string;
  mime: string;
  path: string;
}): Promise<{ kind: "imported" | "exists"; attachment: Attachment }> {
  const { size } = await stat(input.path);
  return importAttachment({
    id: input.id,
    filename: input.filename,
    mime: input.mime,
    size,
    bytes: Bun.file(input.path).stream(),
  });
}
