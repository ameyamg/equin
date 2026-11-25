import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { ConfigV2 } from "@plugins/config_v2/web";
import { pageInstructionsPromptsConfig } from "../core";

export default {
  description:
    "Page agent access, web half: registers the Page instructions prompts config (what every agent is told about page instructions, Settings → Config).",
  contributions: [
    ConfigV2.WebRegister({ descriptor: pageInstructionsPromptsConfig }),
  ],
} satisfies PluginDefinition;
