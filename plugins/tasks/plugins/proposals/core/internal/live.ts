import {
  liveCollection,
  type LiveRowsCollection,
} from "@plugins/network/plugins/live/core";
import { entityRef } from "@plugins/infra/plugins/entities/core";
import {
  ATTACHMENT_LINKS_MAX,
  attachmentLinkFields,
} from "@plugins/infra/plugins/attachments/core";
import { compositeKey } from "@plugins/network/plugins/live/plugins/query-resource/core";
import { proposalsEntityRef } from "./fields";

/**
 * The proposals of one record type's scope (a feed's), newest first — every
 * read scoped `where: { type, scope }` by the view that owns those records;
 * `:rows` reads one proposal by id. The values ride as carried fields: what
 * they hold is the owner's FieldsRecord to say.
 */
export const proposalsList = liveCollection("proposals.list", {
  from: proposalsEntityRef,
  pick: [
    "type",
    "scope",
    "recordId",
    "isNew",
    "state",
    "note",
    "authorTaskId",
    "revision",
    "editedOnMainSinceFork",
    "createdAt",
    "decidedAt",
  ],
  carry: {
    pick: [
      "id",
      "values",
      "baseValues",
      "baseVersion",
      "changed",
      "authorConversationId",
      "worktree",
      "previousId",
      "decisionNote",
    ],
  },
  id: "id",
  sortable: ["createdAt", "decidedAt"],
  default: { orderBy: [["createdAt", "desc"]], limit: 50 },
  maxLimit: 200,
});

export type ProposalRow =
  typeof proposalsList extends LiveRowsCollection<infer R> ? R : never;

/** The `proposals_attachments` link entity — built by `Attachments.defineLink`. */
export const proposalAttachmentLinksEntityRef = entityRef(
  "proposals_attachments",
  attachmentLinkFields,
);

/** One proposal's attachment links, as `attachments.by-owner` follows them. */
export const proposalAttachmentLinks = liveCollection(
  "proposals.attachment-links",
  {
    from: proposalAttachmentLinksEntityRef,
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
