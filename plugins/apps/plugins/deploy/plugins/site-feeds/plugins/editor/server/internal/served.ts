import { serveCollection } from "@plugins/network/plugins/live/server";
import { Attachments } from "@plugins/infra/plugins/attachments/server";
import { siteFeedItemAttachmentLinks, siteFeedItems } from "../../core";
import { siteFeedItemAttachments } from "./schema-attachments";
import { siteFeedItemsEntity } from "./tables";

const itemsServed = serveCollection(siteFeedItems, {
  from: siteFeedItemsEntity,
});

const linksServed = serveCollection(siteFeedItemAttachmentLinks, {
  from: siteFeedItemAttachments.table,
});

export const siteFeedItemsContributions = [
  ...itemsServed.declare,
  ...linksServed.declare,
  Attachments.Link({ link: siteFeedItemAttachments, served: linksServed }),
];
