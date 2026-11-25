import { serveCollection } from "@plugins/network/plugins/live/server";
import { Attachments } from "@plugins/infra/plugins/attachments/server";
import { siteFeedEntryAttachmentLinks } from "../../core";
import { siteFeedEntryAttachments } from "./schema-attachments";

const linksServed = serveCollection(siteFeedEntryAttachmentLinks, {
  from: siteFeedEntryAttachments.table,
});

// An entry's link set, served for `attachments.by-owner` to follow.
export const siteFeedAttachmentLinkContributions = [
  ...linksServed.declare,
  Attachments.Link({ link: siteFeedEntryAttachments, served: linksServed }),
];
