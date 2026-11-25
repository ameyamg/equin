import { defineConfig } from "@plugins/config_v2/core";
import { promptField } from "@plugins/config_v2/plugins/prompts/core";

/**
 * What the `report.required` grant tells the agent in its `## Mandate`
 * section: only what the tool and the stop gate do not say — that nobody is
 * watching. A prompt the user edits (Settings → Config), registered by this
 * plugin's server and web barrels.
 */
export const outcomeReportPromptsConfig = defineConfig({
  name: "agent-instructions",
  fields: {
    mandateLine: promptField({
      label: "Mandate line",
      description:
        "The line an agent whose mandate requires an outcome report reads in its Mandate section (an automation's run, a supervisor's worker).",
      default:
        "The user is not watching: never ask questions mid-way — decide, or stop. End with `{{reportTool}}`.",
      variables: [
        {
          name: "reportTool",
          description: "the outcome report tool's name",
        },
      ],
    }),
  },
});
