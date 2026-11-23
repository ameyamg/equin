import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { studioApp } from "@plugins/apps/plugins/plugin-studio/plugins/shell/core";
import { blockWorkshop } from "../core";

export default {
  description:
    "Studio's building on Isle: the block workshop — jigsaw blocks tenoned into one another around a brass hub, a crane lifting one out and slotting it back, a lens sweeping the stonework.",
  contributions: [Isle.Building({ app: studioApp, building: blockWorkshop })],
} satisfies PluginDefinition;
