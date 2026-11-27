import { defineConfig } from "@plugins/config_v2/core";
import { promptField } from "@plugins/config_v2/plugins/prompts/core";

/**
 * What an agent is told along with a tool's refusal, edited in Settings →
 * Config. Empty by default: the code knows no place to send a wrong refusal
 * (supervisor roles are the user's own), so whoever has one — a harness
 * supervisor, say — names it here.
 */
export const mcpPromptsConfig = defineConfig({
  name: "agent-instructions",
  fields: {
    refusalHint: promptField({
      label: "When a tool refuses",
      description:
        "Appended (after a blank line) to every MCP tool refusal an agent receives — a handler's 4xx HttpError, never a crash. Empty adds nothing.",
      default: "",
      rows: 3,
    }),
  },
});
