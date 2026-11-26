import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Website } from "@plugins/apps/plugins/website/plugins/shell/web";
import { TrySection } from "./components/try-section";

export default {
  description:
    "Landing Try it band: between the hero and the layers, a title, one line and two pill buttons — Open the demo (the live demo page, its box growing out of the button as the demo's Maximize grows the frame) and Download (the download page).",
  contributions: [
    Website.Section({ id: "try", label: "Try it", component: TrySection }),
  ],
} satisfies PluginDefinition;
