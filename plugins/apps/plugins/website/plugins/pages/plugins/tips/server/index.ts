import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { SiteFeeds } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/server";
import { WebsitePages } from "@plugins/apps/plugins/website/plugins/crawlable/server";
import { tipsFeed, tipsPage } from "../core";

export default {
  description:
    "Declares the tips feed to the box (SiteFeeds.Feed), which validates every published tip against it and serves the newest 60 to visitors, and the tips page's sitemap entry (WebsitePages.Page).",
  contributions: [
    SiteFeeds.Feed({ feed: tipsFeed }),
    WebsitePages.Page(tipsPage),
  ],
} satisfies ServerPluginDefinition;
