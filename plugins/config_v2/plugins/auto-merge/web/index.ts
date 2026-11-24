import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import {
  ConfigDetailSlots,
  ConfigNavSlots,
} from "@plugins/config_v2/plugins/settings/web";
import { Notifications } from "@plugins/shell/plugins/notifications/web";
import { AutoMergeBanner } from "./components/auto-merge-banner";
import { autoMergeUndoAction } from "./components/auto-merge-action";
import {
  AutoMergeNavNotice,
  AutoMergedNavField,
} from "./components/auto-merge-nav";
import {
  KeepFieldAction,
  ReviewItemActions,
  UseMineFieldAction,
  UseNewDefaultFieldAction,
} from "./components/review-actions";

export default {
  description:
    "Config updates merged automatically, in the app: above a merged config in Settings → Config, a line for users (updated with the new defaults, your changes kept, the fields the update removed, Undo, Dismiss) and for developers the review — every field the merge touched (old default, yours, new default, result, outcome and why) with Keep / Use mine / Use new default, Undo merge and Mark reviewed; the config nav's Auto-merged field (its authored view) and, for developers, a notice counting the merges not reviewed yet; and the Undo of the update notification announcing them (config-auto-merge).",
  contributions: [
    ConfigDetailSlots.Banner({ id: "auto-merge", component: AutoMergeBanner }),
    Notifications.Action(autoMergeUndoAction),
    ConfigNavSlots.Field({
      id: "autoMerged",
      label: "Auto-merged",
      component: AutoMergedNavField,
    }),
    ConfigNavSlots.Notice({ id: "auto-merged", component: AutoMergeNavNotice }),
    ReviewItemActions({ id: "keep", component: KeepFieldAction }),
    ReviewItemActions({ id: "use-mine", component: UseMineFieldAction }),
    ReviewItemActions({
      id: "use-new-default",
      component: UseNewDefaultFieldAction,
    }),
  ],
  slots: { reviewActions: ReviewItemActions },
} satisfies PluginDefinition;
