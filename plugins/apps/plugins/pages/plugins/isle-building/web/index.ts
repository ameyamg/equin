import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { pagesApp } from "@plugins/apps/plugins/pages/plugins/shell/core";
import { library } from "../core";

export default {
  description:
    "Pages' building on Isle: the library of stacked books under an open-book roof — a note written line by line on its slate, a leaf turning on the lectern, loose leaves drifting down, a ribbon marker stirring.",
  contributions: [Isle.Building({ app: pagesApp, building: library })],
} satisfies PluginDefinition;
