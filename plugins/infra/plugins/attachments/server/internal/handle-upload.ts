import { implement, HttpError } from "@plugins/infra/plugins/endpoints/server";
import { uploadAttachment } from "../../shared/endpoints";
import { ATTACHMENT_DEFAULT_MAX_BYTES } from "../../core";
import { AttachmentTooLargeError } from "./blobs";
import { EmptyAttachmentError, writeNewAttachment } from "./operations";

// Raw-body upload: the file's bytes are streamed into the blob store as they
// arrive (never held in memory), bounded by the caller's declared `maxBytes`
// (at most ATTACHMENT_MAX_BYTES, checked by the query schema). Creates an
// _attachments row with no link yet; callers link the returned id from their
// own submit path by inserting into the appropriate `<owner>_attachments`
// table (see `Attachments.defineLink`). Orphan sweep collects unlinked rows
// past TTL.
export const handleUpload = implement(
  uploadAttachment,
  async ({ body, query, req }) => {
    const maxBytes = query.maxBytes ?? ATTACHMENT_DEFAULT_MAX_BYTES;
    // A declared length past the bound is refused before a byte is read; the
    // streamed count below is the bound itself (a length can be absent).
    const declared = req.headers.get("content-length");
    if (declared !== null && Number(declared) > maxBytes) {
      throw new HttpError(413, new AttachmentTooLargeError(maxBytes).message);
    }
    try {
      const att = await writeNewAttachment({
        id: crypto.randomUUID(),
        filename: query.filename,
        mime: query.mime || "application/octet-stream",
        bytes: body instanceof Blob ? body.stream() : body,
        maxBytes,
      });
      return {
        id: att.id,
        filename: att.filename,
        mime: att.mime,
        size: att.size,
      };
    } catch (err) {
      if (err instanceof AttachmentTooLargeError) {
        throw new HttpError(413, err.message);
      }
      if (err instanceof EmptyAttachmentError) {
        throw new HttpError(400, err.message);
      }
      throw err;
    }
  },
);
