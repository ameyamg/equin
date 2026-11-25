import { entityRef } from "@plugins/infra/plugins/entities/core";
import { compositeKey } from "@plugins/network/plugins/live/plugins/query-resource/core";
import { liveCollection } from "@plugins/network/plugins/live/core";
import {
  ATTACHMENT_LINKS_MAX,
  attachmentLinkFields,
} from "@plugins/infra/plugins/attachments/core";

/** The `decisions_attachments` link entity — its table built by `Attachments.defineLink`. */
export const decisionAttachmentLinksEntityRef = entityRef(
  "decisions_attachments",
  attachmentLinkFields,
);

/**
 * One decision's attachment links — what the user's notes on it attached (a
 * pasted image, a file) — as `attachments.by-owner` follows them for
 * `ownerType: "decisions"`: a scoped set by `ownerId`, in link order.
 */
export const decisionAttachmentLinks = liveCollection(
  "decisions.attachment-links",
  {
    from: decisionAttachmentLinksEntityRef,
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
