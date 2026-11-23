import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { sonataApp } from "@plugins/apps/plugins/sonata/plugins/shell/core";
import { pianoHall } from "../core";

export default {
  description:
    "Sonata's building on Isle: the piano hall, a concert hall built as a grand piano \u2014 the keyboard an awning over the door, the lid propped open over the strings; keys dip, hammers and strings answer, a metronome ticks.",
  contributions: [Isle.Building({ app: sonataApp, building: pianoHall })],
} satisfies PluginDefinition;
