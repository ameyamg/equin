import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { debugApp } from "@plugins/apps/plugins/debug/plugins/shell/core";
import { beetleStation } from "../core";

export default {
  description:
    "Debug's building on Isle: the beetle station — a stone drum under a riveted copper dome of wing-cases with glass spots, an iron cowl for a head, six iron stays for legs — a chart recorder draws its trace, a brass lens follows a live beetle across the specimen board, the trap lantern draws moths at night, the feelers stir, a file of ants runs from its hill up the wall into a crack, and two beetles roam the paving and the wall.",
  contributions: [Isle.Building({ app: debugApp, building: beetleStation })],
} satisfies PluginDefinition;
