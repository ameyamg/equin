import { entityRef } from "@plugins/infra/plugins/entities/core";
import { compositeKey } from "@plugins/network/plugins/live/plugins/query-resource/core";
import { liveCollection } from "@plugins/network/plugins/live/core";
import {
  ATTACHMENT_LINKS_MAX,
  attachmentLinkFields,
} from "@plugins/infra/plugins/attachments/core";

/** The `mail_drafts_attachments` link entity — its table built by `Attachments.defineLink`. */
export const mailDraftAttachmentLinksEntityRef = entityRef(
  "mail_drafts_attachments",
  attachmentLinkFields,
);

/**
 * One draft's uploaded files, as `attachments.by-owner` follows them for
 * `ownerType: "mail_drafts"`: a scoped set by `ownerId`, in link order. A
 * link keeps an upload from the orphan sweep for as long as its draft lives.
 */
export const mailDraftAttachmentLinks = liveCollection(
  "mail.draft-attachment-links",
  {
    from: mailDraftAttachmentLinksEntityRef,
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
