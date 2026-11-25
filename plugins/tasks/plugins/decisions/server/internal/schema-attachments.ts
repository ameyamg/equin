import { Attachments } from "@plugins/infra/plugins/attachments/server";
import { decisionAttachmentLinksEntityRef } from "../../core";
import { _decisions } from "./tables";

// Decision ↔ attachment link: what the user's notes on a decision attached,
// kept for as long as the decision (cascade). Its own file, in the drizzle-kit
// schema glob (`schema-*.ts`), so `./tables.ts` stays free of the attachments
// server.
export const decisionAttachments = Attachments.defineLink(
  _decisions,
  decisionAttachmentLinksEntityRef,
);
// Re-exported for drizzle-kit's schema glob; only the handle is used.
export const _decisionAttachmentsTable = decisionAttachments.table;
