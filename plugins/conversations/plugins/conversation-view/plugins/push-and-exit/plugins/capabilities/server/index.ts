import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ConfigV2 } from "@plugins/config_v2/server";
import { pushExitPromptsConfig } from "../core";

export default {
  description:
    "Registers the push / exit agent-instructions config — what each push policy and exit policy tells the agent — here, beside its definition, so every plugin reading it (the mandate lines, automations' {{pushPolicy}}, outcome-report's next step) has it registered wherever it runs.",
  contributions: [ConfigV2.Register({ descriptor: pushExitPromptsConfig })],
} satisfies ServerPluginDefinition;
