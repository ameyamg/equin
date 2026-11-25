import { defineConfig } from "@plugins/config_v2/core";
import { promptField } from "@plugins/config_v2/plugins/prompts/core";

/** What a task's agents are told about the page the task was filed from
 * (the `source-page` system-prompt section), edited in Settings → Config. */
export const sourcePagePromptsConfig = defineConfig({
  name: "agent-instructions",
  fields: {
    sourcePage: promptField({
      label: "Source page",
      description:
        "Told to a task's agents when the task was filed with its page's URL.",
      default:
        "The user filed this task while on {{url}} — the page their request is about, unless it says otherwise.",
      rows: 2,
      variables: [{ name: "url", description: "the page's URL" }],
    }),
  },
});
