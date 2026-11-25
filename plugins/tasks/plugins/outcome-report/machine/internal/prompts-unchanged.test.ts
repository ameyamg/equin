import { describe, expect, test } from "bun:test";
import { outcomeReportPromptsConfig } from "../../core";
import { reportRequiredLine } from "./report-line";

describe("outcome report prompts render today's text", () => {
  test("the report.required Mandate line", () => {
    expect<unknown>(
      reportRequiredLine(outcomeReportPromptsConfig.defaults),
    ).toBe(
      "The user is not watching: work on your own. If only the user can unblock you, ask with `AskUserQuestion` — it waits for their answer. When you stop, your last message is your report to whoever started you (your supervisor, or the automation): say what you did, what is left and what they must know. Once the user has talked to you, call `turn_for` before you end each turn to say whether it is for the user or your supervisor.",
    );
  });
});
