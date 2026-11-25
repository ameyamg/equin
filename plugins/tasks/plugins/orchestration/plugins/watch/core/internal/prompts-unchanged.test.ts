import { describe, expect, test } from "bun:test";
import { fillPrompt } from "@plugins/config_v2/plugins/prompts/core";
import { watchPromptsConfig } from "./prompts";

// The Mandate lines as the code wrote them before they became prompts: the
// defaults must render them unchanged.
describe("watch prompts render as the hard-coded lines did", () => {
  const c = watchPromptsConfig;
  test("watch.children", () => {
    expect<unknown>(fillPrompt(c, c.defaults, "childrenLine", {})).toBe(
      "What happens under the tasks you file (an agent starting, a report, a question, a flag, a task settling, the subtree going quiet) arrives as an event turn: end your turn while they work, never poll.",
    );
  });
  test("watch.tree", () => {
    expect<unknown>(fillPrompt(c, c.defaults, "treeLine", {})).toBe(
      "As the agent on this tree's root task, you also get those events from anywhere in the tree no nearer watcher takes, and the whole tree going quiet.",
    );
  });
});
