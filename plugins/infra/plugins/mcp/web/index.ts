import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { ConfigV2 } from "@plugins/config_v2/web";
import { mcpPromptsConfig } from "../core";

export default {
  description:
    "Registers the MCP agent-instructions config (the hint appended to a tool's refusal) for Settings → Config.",
  contributions: [ConfigV2.WebRegister({ descriptor: mcpPromptsConfig })],
} satisfies PluginDefinition;
