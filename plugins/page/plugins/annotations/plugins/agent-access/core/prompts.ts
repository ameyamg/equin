import { defineConfig } from "@plugins/config_v2/core";
import { promptField } from "@plugins/config_v2/plugins/prompts/core";

/**
 * What every agent is told about page instructions (the `page-instructions`
 * system-prompt section), edited in Settings → Config. The instructions
 * themselves are the pages' own (data); these are the words around them.
 */
export const pageInstructionsPromptsConfig = defineConfig({
  name: "agent-instructions",
  fields: {
    intro: promptField({
      label: "What page instructions are",
      description:
        "Told to every agent: what page instructions are and how the page tools deliver them.",
      default:
        "equin pages can carry instructions from their author, the way a CLAUDE.md file carries instructions for a folder. They cover the page they sit on (an instructions page covers its parent page) and every page below it. read_page hands you the ones covering what you read, in a <received-instructions> block ahead of the page. edit_page and write_agent_note refuse to write under a page whose instructions you have not received yet; the refusal carries them, so read them and retry. When instructions you received are edited since, the write goes through and its result carries their new version in an <updated-instructions> part.",
      rows: 6,
    }),
    global: promptField({
      label: "Global instructions",
      description:
        "Told to every agent when some instructions are global, followed by them.",
      default:
        "These instructions are global: they apply to every conversation, wherever it works.\n\n{{instructions}}",
      rows: 3,
      variables: [
        {
          name: "instructions",
          description:
            "the global instructions: every global card in full (<global-instructions>), then one Global instructions page line per global page",
        },
      ],
    }),
    pageLine: promptField({
      label: "Global instructions page",
      description:
        "One per global instructions page, which is handed over as a pointer rather than in full.",
      default:
        '{{page}}\nRead this page (read_page with its id) before working under "{{coveredTitle}}".',
      rows: 2,
      variables: [
        {
          name: "page",
          description:
            'the page as a tag: <instructions-page id="…" title="…"/>',
        },
        {
          name: "coveredTitle",
          description: "the title of the page it covers",
        },
      ],
    }),
  },
});
