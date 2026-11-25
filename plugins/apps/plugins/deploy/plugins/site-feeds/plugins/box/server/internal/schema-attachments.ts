import { Attachments } from "@plugins/infra/plugins/attachments/server";
import { siteFeedEntryAttachmentLinksEntityRef } from "../../core";
import { siteFeedEntries } from "./tables";

// Entry ↔ attachment link: what keeps a published entry's media from the
// orphan sweep, and what the public media route checks before serving a file.
export const siteFeedEntryAttachments = Attachments.defineLink(
  siteFeedEntries,
  siteFeedEntryAttachmentLinksEntityRef,
);
// Re-export the underlying pgTable so drizzle-kit's schema glob picks it up.
export const _siteFeedEntryAttachmentsTable = siteFeedEntryAttachments.table;
