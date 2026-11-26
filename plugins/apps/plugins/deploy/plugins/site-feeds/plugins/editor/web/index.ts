import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Pane } from "@plugins/primitives/plugins/pane/web";
import { opensPane } from "@plugins/primitives/plugins/app-shell/web";
import { Deploy } from "@plugins/apps/plugins/deploy/plugins/shell/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { investigateSiteFeedPublications } from "./internal/investigate";
import { feedsPane } from "./panes";
import { SiteFeedEditor } from "./slots";

export { SiteFeedEditor } from "./slots";
export type { SiteFeedCardProps, SiteFeedItemProps } from "./slots";

export default {
  description:
    "The Feeds page of the Deploy app (/deploy/feeds, its sidebar entry): one card per feed a plugin of this app declares (SiteFeeds.Feed) — its items on this computer as a live DataView (columns derived from the feed's own fields: its text as the title, its media as thumbnails; state, published, and a chip per copy of the site it is on), New item, and the opened item's editor (the feed's FieldsForm, autosaved; Publish / Publish again / Unpublish / Delete) with its Published to row: this instance and each deployment shipping the feed's declaring plugin, where the item stands there, its last error, Publish here / Retry — a deployed site said to be published to from main only off main. A failed publication has an Investigate action. What follows a publish shows itself through the SiteFeedEditor slots: a section under a feed's list, chips in an item's row, a section in the opened item.",
  slots: {
    feedSection: SiteFeedEditor.FeedSection,
    itemStatus: SiteFeedEditor.ItemStatus,
    itemSection: SiteFeedEditor.ItemSection,
    "deploy-feeds": feedsPane,
  },
  contributions: [
    investigateSiteFeedPublications,
    Pane.Register({ pane: feedsPane }),
    Deploy.Sidebar({
      id: "feeds",
      title: "Feeds",
      icon: symbol("article"),
      opens: opensPane(feedsPane, {}),
    }),
  ],
} satisfies PluginDefinition;
