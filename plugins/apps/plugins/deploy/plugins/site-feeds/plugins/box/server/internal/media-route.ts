import { and, eq } from "drizzle-orm";
import { db } from "@plugins/database/server";
import {
  contentDisposition,
  rangedBlobResponse,
} from "@plugins/infra/plugins/endpoints/core";
import {
  AttachmentBlobs,
  getAttachment,
} from "@plugins/infra/plugins/attachments/server";
import { siteFeedEntryAttachments } from "./schema-attachments";

/**
 * `GET /api/site-feeds/media/:entryId/:attachmentId` — a published entry's
 * file. Answered only while that entry links that attachment, so a visitor
 * reaches exactly the files published entries show, never any other
 * attachment by id. Byte ranges (a video seeks); immutable (an attachment
 * id names one file forever).
 */
export async function handleSiteFeedMedia(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const { entryId, attachmentId } = params;
  if (!entryId || !attachmentId) {
    return new Response("missing entry or attachment id", { status: 400 });
  }
  const table = siteFeedEntryAttachments.table;
  const [link] = await db
    .select({ attachmentId: table.attachmentId })
    .from(table)
    .where(
      and(eq(table.ownerId, entryId), eq(table.attachmentId, attachmentId)),
    )
    .limit(1);
  if (link === undefined) return new Response("not found", { status: 404 });
  const row = await getAttachment(attachmentId);
  if (row === null) return new Response("not found", { status: 404 });
  const file = await AttachmentBlobs.get().read(row.diskPath);
  if (file === null) {
    return new Response("file missing on disk", { status: 410 });
  }
  return rangedBlobResponse(file, req.headers, {
    "content-type": row.mime,
    ...contentDisposition("inline", row.filename),
    "cache-control": "public, max-age=31536000, immutable",
  });
}
