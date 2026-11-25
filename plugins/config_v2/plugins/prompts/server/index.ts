import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";

export { renderConfigPrompt } from "./internal/render";

export default {
  description:
    "Agent prompts as config, server half: renderConfigPrompt(descriptor, key, variables) — a prompt field as the user saved it now, filled (a PromptText).",
} satisfies ServerPluginDefinition;
