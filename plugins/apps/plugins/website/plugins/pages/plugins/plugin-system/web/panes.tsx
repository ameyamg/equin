import { Pane, defineRoute } from "@plugins/primitives/plugins/pane/web";
import { websiteApp } from "@plugins/apps/plugins/website/plugins/shell/core";
import { pluginSystemPage } from "../core";
import {
  WebsiteHeader,
  websitePagePart,
} from "@plugins/apps/plugins/website/plugins/shell/web";

/**
 * The plugin system page at `/about/plugin-system` — how equin is put
 * together, as one zoom out from a single plugin to the whole system. Wears the
 * shared site header (`actions: WebsiteHeader`) inside `WebsiteChrome`, so the
 * site footer renders exactly once. The body is its own chunk (three.js with
 * it), fetched only where the page is shown.
 */
export const pluginSystemPane = Pane.define({
  route: defineRoute({
    id: "website-plugin-system",
    segment: "plugin-system",
  }),
  app: websiteApp,
  actions: WebsiteHeader,
  title: pluginSystemPage.title,
  component: websitePagePart(pluginSystemPage, () =>
    import("./components/plugin-system-body").then((m) => m.PluginSystemBody),
  ),
});
