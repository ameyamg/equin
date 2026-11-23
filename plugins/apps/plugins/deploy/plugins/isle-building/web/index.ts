import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { deployApp } from "@plugins/apps/plugins/deploy/plugins/shell/core";
import { rocketPad } from "../core";

export default {
  description:
    "Deploy's building on Isle: the rocket itself on its pad, beside a timber gantry — a countdown semaphore drops notch by notch to an engine test, a crate is hoisted aboard, the tank vents steam.",
  contributions: [Isle.Building({ app: deployApp, building: rocketPad })],
} satisfies PluginDefinition;
