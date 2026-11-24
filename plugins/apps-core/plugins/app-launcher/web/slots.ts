import { defineSlot } from "@plugins/framework/plugins/web-sdk/core";
import type { Hint } from "@plugins/hints/core";
import { defineItemActions } from "@plugins/primitives/plugins/data-view/web";
import type { AppRow } from "./internal/installed-app";

export const AppLauncherSlots = {
  /**
   * The tip the launcher carries after the surface LEFT mode `mode` for
   * another — how to go back (the desktop's "Go back to the desktop", after a
   * window went full screen: the launcher's grid lists the desktop). Asked
   * instead of "Switch apps"; its `anchor` must be `appLauncherAnchor`, and it
   * should `supersedes: [appLauncherHint]` so "Switch apps" never follows it.
   * Declare the hint itself with `Hints.Hint` too (the catalog).
   */
  /**
   * Actions on one app in an app gallery (the Home gallery passes it as its
   * DataView's `itemActions`; the launcher's quick grid does not): a plugin
   * that keeps something about each app (its category) offers its edit here.
   */
  AppActions: defineItemActions<AppRow>(),
  ReturnTip: defineSlot<{ mode: string; hint: Hint }>({
    docLabel: (p) => `${p.mode} → ${p.hint.id}`,
  }),
};
