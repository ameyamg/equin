import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { SiteFeedEditor } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/editor/web";
import { AlsoPostTo } from "./components/also-post-to";
import {
  ItemSyndicationChips,
  ItemSyndications,
} from "./components/item-syndications";
import { SyndicationTargets } from "./slots";
import { investigateSyndications } from "./internal/investigate";

export { SyndicationTargets } from "./slots";
export type { SyndicationTargetWebContribution } from "./slots";

export default {
  description:
    "Posting a site feed's items elsewhere, in the Feeds tab: the SyndicationTargets.Target slot a target plugin contributes its declaration to (label, icon, settings fields — nothing here names a target); under each feed, Also post to — every target switched on or off and set up with its own fields (a secret shown only as set or not), or why the feed cannot be cross-posted; in each item's row a chip per target it was sent to; in the opened item, each target's state, its last error and Retry.",
  slots: SyndicationTargets,
  contributions: [
    investigateSyndications,
    SiteFeedEditor.FeedSection({ id: "syndication", component: AlsoPostTo }),
    SiteFeedEditor.ItemStatus({
      id: "syndication",
      component: ItemSyndicationChips,
    }),
    SiteFeedEditor.ItemSection({
      id: "syndication",
      component: ItemSyndications,
    }),
  ],
} satisfies PluginDefinition;
