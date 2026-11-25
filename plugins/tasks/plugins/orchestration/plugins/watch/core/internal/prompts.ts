import { defineConfig } from "@plugins/config_v2/core";
import { promptField } from "@plugins/config_v2/plugins/prompts/core";

/**
 * What an agent that watches the tasks it files is told about pacing itself
 * (its `## Mandate` lines), edited in Settings → Config.
 */
export const watchPromptsConfig = defineConfig({
  name: "agent-instructions",
  fields: {
    childrenLine: promptField({
      label: "Watching the tasks you file",
      description:
        "The Mandate line of an agent that watches the tasks it files (the watch.children grant).",
      default:
        "What happens under the tasks you file (an agent starting, a report, a question, a flag, a task settling, the subtree going quiet) arrives as an event turn: end your turn while they work, never poll.",
      rows: 3,
    }),
    treeLine: promptField({
      label: "Watching the whole tree",
      description:
        "The Mandate line of the agent on a tree's root task that also watches the whole tree (the watch.tree grant).",
      default:
        "As the agent on this tree's root task, you also get those events from anywhere in the tree no nearer watcher takes, and the whole tree going quiet.",
      rows: 3,
    }),
  },
});
