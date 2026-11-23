import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { websiteApp } from "@plugins/apps/plugins/website/plugins/shell/core";
import { shopfront } from "../core";

export default {
  description:
    "The website's building on Isle: the shopfront — the island's public face: a painted shop with two awninged display windows under a great false-front sign board carrying the app's device in a roundel, a banner on its pole, and a poster hoarding in the yard — a carousel of framed pictures turns in the window, a new poster comes down over the old one on the hoarding, the hanging sign and the banner stir, the sign's lamps come on at dusk.",
  contributions: [Isle.Building({ app: websiteApp, building: shopfront })],
} satisfies PluginDefinition;
