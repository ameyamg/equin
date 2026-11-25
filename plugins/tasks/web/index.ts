import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { ConfigV2 } from "@plugins/config_v2/web";
import { taskFilingPromptsConfig } from "../core";

export {
  usePatchTask,
  useTask,
  useTasksById,
  useActiveDependentCount,
} from "./client";
export type { TaskPatch } from "./client";

export default {
  description:
    "Nested tasks with attempts linking to conversations; registers the Task filing instructions config (Settings → Config).",
  contributions: [
    ConfigV2.WebRegister({ descriptor: taskFilingPromptsConfig }),
  ],
} satisfies PluginDefinition;
