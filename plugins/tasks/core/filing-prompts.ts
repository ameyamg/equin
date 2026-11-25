import { defineConfig } from "@plugins/config_v2/core";
import { promptField } from "@plugins/config_v2/plugins/prompts/core";

/**
 * What an agent allowed to file tasks (`tasks.file`) is told about it: its
 * `## Mandate` line and the two clauses that describe a grant beyond its
 * tracks — read by that line, by `add_task`'s description and by its
 * refusals alike. The tracks and start modes themselves are data, listed by
 * the code (`track "main": start "after"`).
 */
export const taskFilingPromptsConfig = defineConfig({
  name: "agent-instructions",
  fields: {
    mandateLine: promptField({
      label: "May file tasks",
      description:
        "The Mandate line of an agent whose mandate lets it file tasks (the tasks.file grant).",
      default:
        "You may file tasks into this subtree with `add_task` — {{grant}}. Any other track or start mode is refused.",
      rows: 3,
      variables: [
        {
          name: "grant",
          description:
            'what the grant allows: its tracks and start modes (`track "main": start "after"`), then the clauses below that apply, joined by "; "',
        },
      ],
    }),
    defaultAfterNone: promptField({
      label: "Clause: no default dependency",
      description:
        "Added to the grant's description when a task filed with no `after` depends on nothing (a supervisor's root).",
      default:
        'with no `after`, an "after" / "manual" task depends on nothing (not on your own task, which stays in progress while the tasks you file run)',
      rows: 2,
    }),
    backlog: promptField({
      label: "Clause: supervisor backlogs",
      description:
        "Added to the grant's description when it may also file into a supervisor role's backlog.",
      default: "or, with `supervisor`, into a supervisor role's backlog",
      rows: 2,
    }),
  },
});
