import { expect, test } from "bun:test";
import { fillPrompt } from "@plugins/config_v2/plugins/prompts/core";
import { pageInstructionsPromptsConfig } from "./prompts";

// The section's words as the code wrote them before they became prompts.
test("the page instructions prompts render as the hard-coded text did", () => {
  const c = pageInstructionsPromptsConfig;
  expect<unknown>(fillPrompt(c, c.defaults, "intro", {})).toBe(
    "equin pages can carry instructions from their author, the way a CLAUDE.md file carries instructions for a folder. They cover the page they sit on (an instructions page covers its parent page) and every page below it. read_page hands you the ones covering what you read, in a <received-instructions> block ahead of the page. edit_page and write_agent_note refuse to write under a page whose instructions you have not received yet; the refusal carries them, so read them and retry. When instructions you received are edited since, the write goes through and its result carries their new version in an <updated-instructions> part.",
  );
  const page = fillPrompt(c, c.defaults, "pageLine", {
    page: '<instructions-page id="P" title="T"/>',
    coveredTitle: "Covered",
  });
  expect<unknown>(page).toBe(
    '<instructions-page id="P" title="T"/>\nRead this page (read_page with its id) before working under "Covered".',
  );
  expect<unknown>(
    fillPrompt(c, c.defaults, "global", {
      instructions: `<global-instructions>\nX\n</global-instructions>\n\n${page}`,
    }),
  ).toBe(
    `These instructions are global: they apply to every conversation, wherever it works.\n\n<global-instructions>\nX\n</global-instructions>\n\n${page}`,
  );
});
