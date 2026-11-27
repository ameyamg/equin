import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Pane } from "@plugins/primitives/plugins/pane/web";
import { Website } from "@plugins/apps/plugins/website/plugins/shell/web";
import { ThemeEngine } from "@plugins/ui/plugins/theme-engine/web";
import { pluginSystemPane } from "./panes";
import { PluginSystemNavItem } from "./components/plugin-system-nav-item";
import { pluginSystemNightTheme } from "./internal/theme";

export { pluginSystemPane } from "./panes";

export default {
  description:
    "The plugin system page of the equin website: the /about/plugin-system pane explaining how equin is put together as one scroll-driven isometric zoom out — a plugin as a glass brick, plugins landing in a slot, the shared infrastructure, one app rising on it, a feature removed and the database swapped, the whole city of apps, and standalone builds lit as subsets of it — eight chapters scrolling over a pinned WebGL stage with a chapter strip under the header, and its entry in the header's Learn menu.",
  contributions: [
    // This pane BORROWS the shared site header (`actions: WebsiteHeader`), so it
    // mints no slot of its own and is deliberately absent from `slots:` — the
    // header is declared once, by `apps.website.shell`.
    Pane.Register({ pane: pluginSystemPane }),
    Website.LearnEntry({
      id: "plugin-system",
      label: "Plugin system",
      component: PluginSystemNavItem,
    }),
    // The page is a night picture in either mode: its ground, ink and header.
    ThemeEngine.SubTheme(pluginSystemNightTheme),
  ],
} satisfies PluginDefinition;
