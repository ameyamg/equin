import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { ConfigV2 } from "@plugins/config_v2/web";
import { pushExitPromptsConfig } from "../core";

export default {
  description:
    "Registers the push / exit agent-instructions config for Settings → Config and every browser reader (the upstream update row's {{pushPolicy}}).",
  contributions: [ConfigV2.WebRegister({ descriptor: pushExitPromptsConfig })],
} satisfies PluginDefinition;
