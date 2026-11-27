import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { ConfigNavSlots } from "@plugins/config_v2/plugins/settings/web";
import { PromptsNavField } from "./components/prompts-nav-field";

export default {
  description:
    "Agent prompts as config, web half: the config nav's Prompts field (Settings → Config's filter keeping every config that holds a prompt field, whichever plugin owns it).",
  contributions: [
    ConfigNavSlots.Field({
      id: "prompts",
      label: "Prompts",
      component: PromptsNavField,
    }),
  ],
} satisfies PluginDefinition;
