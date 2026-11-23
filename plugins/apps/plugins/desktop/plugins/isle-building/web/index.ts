import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { desktopApp } from "@plugins/apps/plugins/desktop/plugins/shell/core";
import { windowGallery } from "../core";

export default {
  description:
    "Desktop's building on Isle: the window gallery — a hall under a glasshouse roof beside a spired tower, glazed screens boxed out on iron tracks over a painted backdrop, a shelf of things kept to hand along its foot — the front screen rolls from over its neighbour to over the tower's corner and back, the backdrop winds on to another scene, a blind is let down and drawn up, the shelf's lamp burns from dusk.",
  contributions: [Isle.Building({ app: desktopApp, building: windowGallery })],
} satisfies PluginDefinition;
