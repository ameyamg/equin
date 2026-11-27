import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { IdKinds } from "@plugins/ids/web";
import { siteFeedEntryIdKind } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { SiteFeeds } from "./slots";

export { SiteFeeds } from "./slots";
export type { SiteFeedPreviewProps, SiteFeedWebContribution } from "./slots";
export { useSiteFeed } from "./internal/use-site-feed";
export type { SiteFeedEntry } from "./internal/use-site-feed";
export { siteFeedMediaAsset } from "./internal/media-asset";
export { useSiteFeedDeclarations } from "./internal/declarations";
export type { SiteFeedDeclaration } from "./internal/declarations";

export default {
  description:
    "A site's feeds in the browser: the SiteFeeds.Feed slot a site plugin contributes its feed declarations to (read with their declaring plugin by useSiteFeedDeclarations), useSiteFeed(feed) — a feed's published entries live, newest first, values typed by the declaration (a ResourceResult) — and siteFeedMediaAsset(entryId, attachmentId), a published file's public address. A site renders a feed by importing this barrel, which pulls the box's server half into its composition. Registers the site-feed entry id kind (sfe) — the server barrel registers the same kind.",
  slots: SiteFeeds,
  contributions: [IdKinds.Kind({ kind: siteFeedEntryIdKind })],
} satisfies PluginDefinition;
