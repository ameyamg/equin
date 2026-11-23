import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { chordApp } from "@plugins/apps/plugins/chord/plugins/shell/core";
import { bandstand } from "../core";

export default {
  description:
    "Chord's building on Isle: the bandstand, a Belle-\u00c9poque park music kiosk \u2014 cast-iron columns, a swooping green copper roof with a gilt lyre vane, a stage set with piano, bass, guitar, accordion and brass; each chord rings its strings, swings three or four chimes in the frieze and lights one of four coloured lanterns, beside a campfire with log seats.",
  contributions: [Isle.Building({ app: chordApp, building: bandstand })],
} satisfies PluginDefinition;
