import { entityRef } from "@plugins/infra/plugins/entities/core";
import { compositeKey } from "@plugins/network/plugins/live/plugins/query-resource/core";
import { liveCollection } from "@plugins/network/plugins/live/core";
import {
  ATTACHMENT_LINKS_MAX,
  attachmentLinkFields,
} from "@plugins/infra/plugins/attachments/core";

/** The `site_feed_entries_attachments` link entity — its table built by `Attachments.defineLink`. */
export const siteFeedEntryAttachmentLinksEntityRef = entityRef(
  "site_feed_entries_attachments",
  attachmentLinkFields,
);

/**
 * One entry's attachment links, as `attachments.by-owner` follows them for
 * `ownerType: "site_feed_entries"`: a scoped set by `ownerId`, in link order.
 */
export const siteFeedEntryAttachmentLinks = liveCollection(
  "site-feeds.entry-attachment-links",
  {
    from: siteFeedEntryAttachmentLinksEntityRef,
    carry: { pick: ["ownerId", "attachmentId", "createdAt"] },
    baseExposures: false,
    id: compositeKey(["ownerId", "attachmentId"]),
    all: {
      by: ["ownerId"],
      orderBy: [["createdAt", "asc"]],
      max: ATTACHMENT_LINKS_MAX,
    },
  },
);
