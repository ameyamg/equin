import {
  serveCollection,
  serveValue,
} from "@plugins/network/plugins/live/server";
import { Attachments } from "@plugins/infra/plugins/attachments/server";
import {
  siteFeedItemAttachmentLinks,
  siteFeedItems,
  siteFeedPublications,
  sitePublishScope,
} from "../../core";
import { siteFeedItemAttachments } from "./schema-attachments";
import { siteFeedItemsEntity, siteFeedPublicationsEntity } from "./tables";
import { publishScope } from "./destinations";

const itemsServed = serveCollection(siteFeedItems, {
  from: siteFeedItemsEntity,
});

const linksServed = serveCollection(siteFeedItemAttachmentLinks, {
  from: siteFeedItemAttachments.table,
});

const publicationsServed = serveCollection(siteFeedPublications, {
  from: siteFeedPublicationsEntity,
});

const publishScopeServed = serveValue(sitePublishScope, {
  source: "external",
  changes: {
    fixed: {
      reason:
        "whether this process is main's backend — its declared runtime namespace, constant for its lifetime",
    },
  },
  loader: async () => publishScope(),
});

export const siteFeedItemsContributions = [
  ...itemsServed.declare,
  ...linksServed.declare,
  ...publicationsServed.declare,
  ...publishScopeServed.declare,
  Attachments.Link({ link: siteFeedItemAttachments, served: linksServed }),
];
