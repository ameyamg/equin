import { Theme } from "@plugins/primitives/plugins/css/plugins/theme-boundary/web";
import { subThemeScope } from "@plugins/primitives/plugins/css/plugins/ui-kit/core";
import { WebsiteChrome } from "@plugins/apps/plugins/website/plugins/shell/web";
import { pluginSystemPane } from "../panes";
import { pluginSystemNightTheme } from "../internal/theme";
import { PluginSystemZoom } from "./plugin-system-zoom";

/**
 * The plugin system page's body: the heading and the zoom, on the page's own
 * night (`pluginSystemNightTheme`, the header included), inside
 * `WebsiteChrome`, so the site footer renders exactly once. Its own chunk
 * (`websitePagePart`), fetched only where the page is shown.
 */
export function PluginSystemBody() {
  return (
    <WebsiteChrome
      pane={pluginSystemPane}
      headerGlass
      headerTheme={pluginSystemNightTheme}
    >
      <Theme
        name={subThemeScope(pluginSystemNightTheme)}
        surface="canvas"
        className="plugin-system-page"
      >
        <PluginSystemZoom />
      </Theme>
    </WebsiteChrome>
  );
}
