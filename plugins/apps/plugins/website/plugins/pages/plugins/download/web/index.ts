import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Pane } from "@plugins/primitives/plugins/pane/web";
import { WebsiteHeader } from "@plugins/apps/plugins/website/plugins/shell/web";
import { downloadPane } from "./panes";
import { ThemeEngine } from "@plugins/ui/plugins/theme-engine/web";
import {
  DemoBarDownload,
  DemoNavItem,
  DownloadNavItem,
} from "./components/download-nav-item";
import { LiveDemo } from "@plugins/apps/plugins/website/plugins/live-demo/web";
import {
  equinDownloadNoteTheme,
  equinDownloadTabsTheme,
  equinDownloadTheme,
} from "./internal/theme";

export { downloadPane } from "./panes";

export default {
  description:
    "The download page of the equin website: the /about/download pane with the one install command (or, for an agent, a prompt with deep links into Claude Code and the Claude app), what to do once it runs, then two closing cards: Learn the tricks (the tips page) and Try it in your browser first (the live demo full screen, agents off there), its two header items: Download (a page link to this page) and ▶ Demo (the live demo, an outlined pill beside Wish), and Download in the demo page's site bar (LiveDemo.BarLink).",
  contributions: [
    // This pane BORROWS the shared site header (`actions: WebsiteHeader`), so it
    // mints no slot of its own — the header is declared once, by
    // `apps.website.shell`.
    Pane.Register({ pane: downloadPane }),
    WebsiteHeader({ id: "download", component: DownloadNavItem }),
    WebsiteHeader({ id: "demo", component: DemoNavItem }),
    LiveDemo.BarLink({
      id: "download",
      label: "Download",
      component: DemoBarDownload,
    }),
    // The page body's sizes and its caveats note's and its audience switch's, each worn over the site's
    // equin-document by its own region of the page.
    ThemeEngine.SubTheme(equinDownloadTheme),
    ThemeEngine.SubTheme(equinDownloadNoteTheme),
    ThemeEngine.SubTheme(equinDownloadTabsTheme),
  ],
} satisfies PluginDefinition;
