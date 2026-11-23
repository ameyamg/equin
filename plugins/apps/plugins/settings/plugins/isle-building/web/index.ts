import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { settingsApp } from "@plugins/apps/plugins/settings/plugins/shell/core";
import { gearMill } from "../core";

export default {
  description:
    "Settings' building on Isle: the gear mill — a stone tower mill whose sails are one great cog wheel, meshing with two pinions that drive the regulator in the lean-to; a lever is thrown now and then, and the regulator dial and the flyball governor follow.",
  contributions: [Isle.Building({ app: settingsApp, building: gearMill })],
} satisfies PluginDefinition;
