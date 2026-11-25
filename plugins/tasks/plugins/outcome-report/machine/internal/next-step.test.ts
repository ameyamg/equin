import { describe, expect, test } from "bun:test";
import {
  exitWhenPrompt,
  pushExitPromptsConfig,
} from "@plugins/conversations/plugins/conversation-view/plugins/push-and-exit/plugins/capabilities/core";
import { nextStepAfterReport } from "./next-step";

const prompts = pushExitPromptsConfig.defaults;

describe("nextStepAfterReport", () => {
  test("follows the mandate's exit rule", () => {
    expect(nextStepAfterReport("when-done", false, prompts)).toContain(
      exitWhenPrompt(prompts, "when-done"),
    );
    expect(nextStepAfterReport("on-request", false, prompts)).toContain(
      exitWhenPrompt(prompts, "on-request"),
    );
  });
  test("a pending question waits for its answer", () => {
    expect(nextStepAfterReport("when-done", true, prompts)).not.toContain(
      "exit_clean",
    );
  });
  test("no exit grant leaves the conversation open", () => {
    expect(nextStepAfterReport(null, false, prompts)).toContain("do not close");
  });
});
