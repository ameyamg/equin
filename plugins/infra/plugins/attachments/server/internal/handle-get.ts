import {
  contentDisposition,
  rangedBlobResponse,
} from "@plugins/infra/plugins/endpoints/core";
import { getAttachment } from "./operations";
import { AttachmentBlobs } from "./blobs";

// Honours `Range` (`rangedBlobResponse`), so an attached video or audio file
// seeks, and plays at all in Safari.
export async function handleGet(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const id = params.id;
  if (!id) return new Response("missing id", { status: 400 });

  const row = await getAttachment(id);
  if (!row) return new Response("not found", { status: 404 });

  const file = await AttachmentBlobs.get().read(row.diskPath);
  if (file === null) {
    return new Response("file missing on disk", { status: 410 });
  }

  return rangedBlobResponse(file, req.headers, {
    "content-type": row.mime,
    ...contentDisposition("inline", row.filename),
    "cache-control": "private, max-age=3600",
  });
}
