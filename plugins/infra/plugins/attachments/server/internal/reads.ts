import { _attachments } from "./tables";

/**
 * What reading an attachment by id reads in Postgres — `getAttachment`,
 * `readAttachmentBytes` and `importAttachment`'s existence check: the
 * `attachments` rows. A live value whose loader calls one declares this in
 * its `reads` — routed (`tables`: a row appearing or being swept re-reads it)
 * or `notified` when its own notify already carries every change that matters
 * — so the drift guard accepts the read; the table stays this plugin's to name.
 */
export const attachmentReads = {
  tables: [_attachments],
  reason:
    "the loader reads attachments rows by id (getAttachment / readAttachmentBytes / importAttachment)",
};
