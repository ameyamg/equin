import { useOpenPane } from "@plugins/primitives/plugins/pane/web";
import { WebsiteLearnLink } from "@plugins/apps/plugins/website/plugins/shell/web";
import { pluginSystemPane } from "../panes";

/**
 * "Plugin system" in the shared site header's Learn menu. Opens the plugin
 * system page.
 */
export function PluginSystemNavItem() {
  const openPane = useOpenPane();
  return (
    <WebsiteLearnLink
      label="Plugin system"
      gloss="How everything is built from plugins"
      {...openPane.link(pluginSystemPane, {}, { mode: "root" })}
    />
  );
}
