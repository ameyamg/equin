import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { ConfigDetailSlots } from "@plugins/config_v2/plugins/settings/web";
import { Notifications } from "@plugins/shell/plugins/notifications/web";
import { AutoMergeBanner } from "./components/auto-merge-banner";
import { autoMergeUndoAction } from "./components/auto-merge-action";

export default {
  description:
    "Config updates merged automatically, in the app: a line above a merged config in Settings → Config (updated with the new defaults, your changes kept, the fields the update removed, Undo, Dismiss) and the Undo of the update notification announcing them (config-auto-merge).",
  contributions: [
    ConfigDetailSlots.Banner({ id: "auto-merge", component: AutoMergeBanner }),
    Notifications.Action(autoMergeUndoAction),
  ],
} satisfies PluginDefinition;
