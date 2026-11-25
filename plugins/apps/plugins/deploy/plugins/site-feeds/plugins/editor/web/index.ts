import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { SiteTabs } from "@plugins/apps/plugins/deploy/plugins/deployments/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { FeedsSection } from "./components/feeds-section";
import { useFeedsAvailable } from "./internal/use-feeds-available";
import { investigateSiteFeedItems } from "./internal/investigate";
import { SiteFeedEditor } from "./slots";

export { SiteFeedEditor } from "./slots";
export type { SiteFeedCardProps, SiteFeedItemProps } from "./slots";

export default {
  description:
    "Feeds tab of a site's page, shown only when the deployment's composition ships a plugin declaring a site feed (SiteFeeds.Feed): one card per shipped feed — its items on this computer as a live DataView (columns derived from the feed's own fields: its text as the title, its media as thumbnails; state, publishing, published), New item, and the opened item's editor (the feed's FieldsForm, autosaved; Publish / Publish again / Unpublish / Delete; the last publish error in words). What follows a publish shows itself through the SiteFeedEditor slots: a section under a feed's list, chips in an item's row, a section in the opened item.",
  slots: {
    feedSection: SiteFeedEditor.FeedSection,
    itemStatus: SiteFeedEditor.ItemStatus,
    itemSection: SiteFeedEditor.ItemSection,
  },
  contributions: [
    investigateSiteFeedItems,
    SiteTabs.View({
      id: "feeds",
      title: "Feeds",
      icon: symbol("article"),
      component: FeedsSection,
      useAvailable: useFeedsAvailable,
    }),
  ],
} satisfies PluginDefinition;
