import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Pane } from "@plugins/primitives/plugins/pane/web";
import { DebugApp } from "@plugins/apps/plugins/debug/plugins/shell/web";
import { ConfigNavSlots } from "@plugins/config_v2/plugins/settings/web";
import { configOrphansPane } from "./panes";
import { StrandedConfigNotice } from "./components/stranded-config-notice";
import {
  ConfigOrphanItemActions,
  DiscardOrphanAction,
} from "./components/discard-orphan-action";
import { symbol } from "@plugins/ui/plugins/icons/core";

export { configOrphansPane } from "./panes";

export default {
  description:
    "Audit of orphaned user-layer config files whose defineConfig descriptor is no longer live (each discardable from its row), plus a notice pinned above Settings → Config when any of the user's own saved settings no longer apply.",
  contributions: [
    Pane.Register({ pane: configOrphansPane }),
    DebugApp.Sidebar({
      id: "config-orphans",
      title: "Config Orphans",
      icon: symbol("rule-folder"),
      opens: { pane: configOrphansPane, params: {} },
    }),
    ConfigNavSlots.Notice({
      id: "stranded-config",
      component: StrandedConfigNotice,
    }),
    ConfigOrphanItemActions({ id: "discard", component: DiscardOrphanAction }),
  ],
  slots: {
    "config-orphans": configOrphansPane,
    itemActions: ConfigOrphanItemActions,
  },
} satisfies PluginDefinition;
