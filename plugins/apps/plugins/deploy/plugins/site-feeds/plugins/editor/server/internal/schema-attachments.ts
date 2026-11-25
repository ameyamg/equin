import { Attachments } from "@plugins/infra/plugins/attachments/server";
import { siteFeedItemAttachmentLinksEntityRef } from "../../core";
import { _siteFeedItems } from "./tables";

// Item ↔ attachment link: what keeps an item's media (drafts included) from
// the orphan sweep. Set from the values' media refs on every save.
export const siteFeedItemAttachments = Attachments.defineLink(
  _siteFeedItems,
  siteFeedItemAttachmentLinksEntityRef,
);
// Re-export the underlying pgTable so drizzle-kit's schema glob picks it up.
export const _siteFeedItemAttachmentsTable = siteFeedItemAttachments.table;
