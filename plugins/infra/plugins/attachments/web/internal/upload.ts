import type { z } from "zod";
import type { FetchEndpoint } from "@plugins/infra/plugins/endpoints/web";
import { holdReload } from "@plugins/primitives/plugins/dom/plugins/reload-readiness/web";
import {
  uploadAttachment as uploadAttachmentEndpoint,
  type UploadedAttachmentSchema,
} from "../../shared/endpoints";

export type UploadedAttachment = z.infer<typeof UploadedAttachmentSchema>;

// Staged upload: POSTs a file's bytes to /api/attachments (streamed to the
// blob store server-side). Server creates a row with no owner link and returns
// the id; the caller links it from its own submit path (`Attachments.defineLink`)
// or holds it (`holdAttachments`). Over the caller's transport: a component
// passes its `useFetchEndpoint()`, a paste handler the one it was built with.
// `maxBytes` is the caller's bound (a video field's), at most
// ATTACHMENT_MAX_BYTES; absent, ATTACHMENT_DEFAULT_MAX_BYTES.
export async function uploadAttachment(
  fetchEndpoint: FetchEndpoint,
  file: File | Blob,
  filename: string,
  mime: string,
  opts: { maxBytes?: number } = {},
): Promise<UploadedAttachment> {
  // A reload would cut the request: the page is held until it settles.
  const release = holdReload("Upload");
  try {
    return await fetchEndpoint(
      uploadAttachmentEndpoint,
      {},
      {
        body: file,
        query: { filename, mime, maxBytes: opts.maxBytes },
      },
    );
  } finally {
    release();
  }
}
