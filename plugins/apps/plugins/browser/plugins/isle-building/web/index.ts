import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { browserApp } from "@plugins/apps/plugins/browser/plugins/shell/core";
import { globeHouse } from "../core";

export default {
  description:
    "The Browser's building on Isle: the world globe on its stone drum — lights running between its cities like requests, a ship crossing the Atlantic, a semaphore signalling, a relay moon on its rail.",
  contributions: [Isle.Building({ app: browserApp, building: globeHouse })],
} satisfies PluginDefinition;
