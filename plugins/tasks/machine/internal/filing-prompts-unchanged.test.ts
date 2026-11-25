import { describe, expect, test } from "bun:test";
import { fillPrompt } from "@plugins/config_v2/plugins/prompts/core";
import { taskFilingPromptsConfig } from "../../core";
import { describeFilingGrant } from "./add-task-filing";

// What the grant read as before its clauses and Mandate line became prompts.
describe("task filing prompts render as the hard-coded text did", () => {
  const c = taskFilingPromptsConfig;
  const line = (grant: Parameters<typeof describeFilingGrant>[0]) =>
    fillPrompt(c, c.defaults, "mandateLine", {
      grant: describeFilingGrant(grant, c.defaults),
    });

  test("the interactive grant", () => {
    expect<unknown>(
      line({
        main: { start: ["after"] },
        sidequest: { start: ["manual"] },
        backlog: true,
      }),
    ).toBe(
      'You may file tasks into this subtree with `add_task` — track "main": start "after"; track "sidequest": start "manual"; or, with `supervisor`, into a supervisor role\'s backlog. Any other track or start mode is refused.',
    );
  });

  test("a supervisor's root: no default dependency, a default model", () => {
    expect<unknown>(
      line({
        main: { start: ["now", "after", "manual"], model: "opus" },
        defaultAfter: "none",
      }),
    ).toBe(
      'You may file tasks into this subtree with `add_task` — track "main": start "now" | "after" | "manual" (default model opus); with no `after`, an "after" / "manual" task depends on nothing (not on your own task, which stays in progress while the tasks you file run). Any other track or start mode is refused.',
    );
  });

  test("no track", () => {
    expect<unknown>(describeFilingGrant({}, c.defaults)).toBe("no track");
  });
});
