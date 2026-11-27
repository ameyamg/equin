import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Website } from "@plugins/apps/plugins/website/plugins/shell/web";
import { HomeTrySection, PageEndTrySection } from "./components/try-section";

export default {
  description:
    "The site's Try it band: a title, one line and two pill buttons — Open the demo (the live demo page, its box growing out of the button as the demo's Maximize grows the frame) and Download (the download page). On the homepage between the hero and the layers, and at the end of every other reading page (Website.PageEnd).",
  contributions: [
    Website.Section({ id: "try", label: "Try it", component: HomeTrySection }),
    Website.PageEnd({
      id: "try",
      label: "Try it",
      component: PageEndTrySection,
    }),
  ],
} satisfies PluginDefinition;
