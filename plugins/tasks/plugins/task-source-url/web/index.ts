import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { ConfigV2 } from "@plugins/config_v2/web";
import { sourcePagePromptsConfig } from "../core";

export { useAttemptSourceUrl } from "./hooks/use-attempt-source-url";
export { TaskSourceUrlRow } from "./components/task-source-url-row";

export default {
  description:
    "Reads back the page a task was filed from: by attempt (useAttemptSourceUrl), and by task as the task header's read-only Filed from row (TaskSourceUrlRow); registers the Source page instructions config (Settings → Config).",
  contributions: [
    ConfigV2.WebRegister({ descriptor: sourcePagePromptsConfig }),
  ],
} satisfies PluginDefinition;
