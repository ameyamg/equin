import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Isle } from "@plugins/apps/plugins/isle/plugins/buildings/web";
import { prototypesApp } from "@plugins/apps/plugins/prototypes/plugins/shell/core";
import { buildingSite } from "../core";

export default {
  description:
    "Prototypes' building on Isle: a half-timbered house being built beside a big wooden treadwheel crane — the crane lifting timber over the frame, shingles laid course by course, lines added to the blueprint pinned over the doorway, a builder hammering on the scaffold.",
  contributions: [
    Isle.Building({ app: prototypesApp, building: buildingSite }),
  ],
} satisfies PluginDefinition;
