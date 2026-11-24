import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Core } from "@plugins/framework/plugins/web-sdk/core";
import { FailedActionToast } from "./components/failed-action-toast";

export default {
  description:
    "The tab's own answer when a user's action crashes: an error thrown while the browser is still dispatching a trusted click, key or submit (so, by that input's own handler) raises a \"That didn't work\" toast in that tab at once, on every occurrence — a repeat replaces the toast on screen instead of stacking. The crash is still filed by the crash collector; its de-duplicated report and bell row are untouched.",
  contributions: [Core.Root({ component: FailedActionToast, scope: "page" })],
} satisfies PluginDefinition;
