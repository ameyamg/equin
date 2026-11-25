import { describe, expect, test } from "bun:test";
import { outcomeReportPromptsConfig } from "../../core";
import { reportRequiredLine } from "./report-line";

describe("outcome report prompts render today's text", () => {
  test("the report.required Mandate line", () => {
    expect<unknown>(
      reportRequiredLine(outcomeReportPromptsConfig.defaults),
    ).toBe(
      "The user is not watching: never ask questions mid-way — decide, or stop. End with `submit_outcome_report`.",
    );
  });
});
