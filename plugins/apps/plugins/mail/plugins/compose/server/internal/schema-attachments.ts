import { Attachments } from "@plugins/infra/plugins/attachments/server";
import { mailDraftAttachmentLinksEntityRef } from "../../core";
import { _mailDrafts } from "./tables";

// Draft ↔ uploaded file: what the person attached to a draft, kept for as
// long as the draft (cascade). Its own file, in the drizzle-kit schema glob
// (`schema-*.ts`), so `./tables.ts` stays free of the attachments server.
export const mailDraftAttachments = Attachments.defineLink(
  _mailDrafts,
  mailDraftAttachmentLinksEntityRef,
);
// Re-exported for drizzle-kit's schema glob; only the handle is used.
export const _mailDraftAttachmentsTable = mailDraftAttachments.table;
