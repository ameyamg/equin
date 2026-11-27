import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { ConfigV2 } from "@plugins/config_v2/web";
import { outcomeReportPromptsConfig } from "../core";

export default {
  description:
    "Outcome reports, web half: registers the report.required Mandate line (a prompt config) for Settings → Config. Nothing is drawn: a handed-back run's report is its agent's last message, already the transcript's last line.",
  contributions: [
    ConfigV2.WebRegister({ descriptor: outcomeReportPromptsConfig }),
  ],
} satisfies PluginDefinition;
