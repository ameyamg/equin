import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ConfigV2 } from "@plugins/config_v2/server";
import { compositionsConfig } from "@plugins/plugin-meta/plugins/composition/core";
import { compositionDataServed } from "./internal/live";

export { compositionIncludesEach } from "./internal/includes";
export type { CompositionInclusionEach } from "./internal/includes";

export default {
  description:
    "Serves the classified edge graph for the Studio closure visualization; registers the runtime-editable compositions config; compositionIncludesEach(name, pluginIds) — which of these plugins a composition's resolved closure includes, the server twin of useCompositionIncludesEach.",
  contributions: [
    ConfigV2.Register({ descriptor: compositionsConfig }),
    ...compositionDataServed.declare,
  ],
} satisfies ServerPluginDefinition;
