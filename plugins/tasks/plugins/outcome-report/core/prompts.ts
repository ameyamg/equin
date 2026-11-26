import { defineConfig } from "@plugins/config_v2/core";
import { promptField } from "@plugins/config_v2/plugins/prompts/core";

/**
 * What the `report.required` grant tells the agent in its `## Mandate`
 * section: nobody is watching, how to ask when blocked, that its last message
 * is its report, and how to say whether a turn waits on the user — the stop gate repeats
 * only that last part, when it applies. A prompt the user edits
 * (Settings → Config), registered by this plugin's server and web barrels.
 */
export const outcomeReportPromptsConfig = defineConfig({
  name: "agent-instructions",
  fields: {
    mandateLine: promptField({
      label: "Mandate line",
      description:
        "The line an agent whose runs are handed back reads in its Mandate section (an automation's run, a supervisor's worker).",
      default:
        "The user is not watching: work on your own. If only the user can unblock you, ask with `AskUserQuestion` — it waits for their answer. When you stop, your last message is your report to whoever started you (your supervisor, or the automation): say what you did, what is left and what they must know. Once the user has talked to you, call `{{turnForTool}}` before you end each turn: `user` only while you need the user's reply or decision to go on; otherwise (the work is done, or you are blocked on someone else) `supervisor`, even when your message answers the user, so whoever started you is told and closes or continues the conversation.",
      variables: [
        {
          name: "turnForTool",
          description: "the tool that says whom a turn is for",
        },
      ],
    }),
  },
});
