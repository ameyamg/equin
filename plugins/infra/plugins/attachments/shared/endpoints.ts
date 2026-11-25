import { z } from "zod";
import {
  byteStream,
  defineEndpoint,
} from "@plugins/infra/plugins/endpoints/core";
import { ATTACHMENT_MAX_BYTES } from "../core";

export const UploadedAttachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mime: z.string(),
  size: z.number(),
});

// The file's bytes as the raw body, streamed to the blob store (never held in
// memory). `maxBytes` is the caller's own bound (a media field's), at most
// ATTACHMENT_MAX_BYTES; absent, ATTACHMENT_DEFAULT_MAX_BYTES.
export const uploadAttachment = defineEndpoint({
  route: "POST /api/attachments",
  body: byteStream(),
  query: z.object({
    filename: z.string().min(1),
    mime: z.string(),
    maxBytes: z.coerce
      .number()
      .int()
      .positive()
      .max(ATTACHMENT_MAX_BYTES)
      .optional(),
  }),
  response: UploadedAttachmentSchema,
});

export const deleteAttachmentEndpoint = defineEndpoint({
  route: "DELETE /api/attachments/:id",
  internal: {
    why: "no browser client: only the server's own attachment cleanup deletes blobs",
  },
});

// Replace the attachments one holder (an unsent draft) keeps alive with `ids`,
// for `ttlMs` from now (null: until the holder releases them). An empty `ids`
// releases the holder. Ids that no longer exist are ignored.
export const holdAttachmentsEndpoint = defineEndpoint({
  route: "PUT /api/attachments/holds",
  body: z.object({
    holder: z.string().min(1),
    ids: z.array(z.string()),
    ttlMs: z.number().positive().nullable(),
  }),
});
