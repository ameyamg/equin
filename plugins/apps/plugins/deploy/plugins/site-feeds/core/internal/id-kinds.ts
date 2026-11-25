import { defineIdKind, type IdOf } from "@plugins/ids/core";

/**
 * One item of a site feed (`site_feed_entries.id` on the box): minted by the
 * computer that holds the item, and the same id on the box it is published to.
 */
export const siteFeedEntryIdKind = defineIdKind({
  prefix: "sfe",
  label: "Site feed entry",
});

export type SiteFeedEntryId = IdOf<typeof siteFeedEntryIdKind>;
