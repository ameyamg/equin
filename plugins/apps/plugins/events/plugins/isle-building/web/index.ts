import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { eventsApp } from "@plugins/apps/plugins/events/plugins/shell/core";
import { calendarTower } from "../core";

export default {
  description:
    "Events' building on Isle: the calendar tower — a clock showing the real time over a great tear-off calendar whose leaf flutters down each day, signal balls run up its mast one per event.",
  contributions: [Isle.Building({ app: eventsApp, building: calendarTower })],
} satisfies PluginDefinition;
