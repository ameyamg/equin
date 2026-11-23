import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { homeApp } from "@plugins/apps/plugins/home/plugins/shell/core";
import { gatehouse } from "../core";

export default {
  description:
    "Home's building on Isle: the gatehouse inn at the crossroads — a steep gabled house with a carriage arch through its wing and a bell-cote on its ridge, its gable carrying a signboard of nine enamelled tiles — one tile at a time turns over (the bell swings for each), the fingerpost's top arm swings round to point a new way, the welcome lantern sways, burns from dusk and draws moths.",
  contributions: [Isle.Building({ app: homeApp, building: gatehouse })],
} satisfies PluginDefinition;
