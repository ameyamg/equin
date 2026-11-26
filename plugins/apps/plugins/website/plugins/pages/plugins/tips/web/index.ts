import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Pane } from "@plugins/primitives/plugins/pane/web";
import { SiteFeeds } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/web";
import { Website } from "@plugins/apps/plugins/website/plugins/shell/web";
import { tipsFeed } from "../core";
import { tipsPane } from "./panes";
import { TipsNavItem } from "./components/tips-nav-item";

export { tipsPane } from "./panes";
export { TipsBulb } from "./components/tips-bulb";

export default {
  description:
    "The tips page of the equin website: the tips feed declared to the editor (SiteFeeds.Feed), the /about/tips pane showing the published tips newest first — title, text, then each screenshot and video — its entry in the header's Learn menu, and the tips' mark (TipsBulb: a lit lightbulb in the site's one warm light, declared once here), which the page's heading and the Download page's Learn the tricks card wear.",
  contributions: [
    SiteFeeds.Feed({ feed: tipsFeed }),
    // Borrows the shared site header (`actions: WebsiteHeader`), so it mints
    // no slot of its own.
    Pane.Register({ pane: tipsPane }),
    Website.LearnEntry({ id: "tips", label: "Tips", component: TipsNavItem }),
  ],
} satisfies PluginDefinition;
