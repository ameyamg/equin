import { expect, test } from "bun:test";
import { fillPrompt } from "@plugins/config_v2/plugins/prompts/core";
import { sourcePagePromptsConfig } from "./prompts";

test("the source page section renders as the hard-coded one did", () => {
  const c = sourcePagePromptsConfig;
  expect<unknown>(
    fillPrompt(c, c.defaults, "sourcePage", {
      url: "http://equin.localhost/x",
    }),
  ).toBe(
    "The user filed this task while on http://equin.localhost/x — the page their request is about, unless it says otherwise.",
  );
});
