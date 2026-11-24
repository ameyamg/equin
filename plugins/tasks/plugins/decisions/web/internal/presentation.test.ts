import { describe, expect, test } from "bun:test";
import { decisionPresentation } from "./presentation";

describe("decisionPresentation", () => {
  test("each open state reads its own pill", () => {
    const of = (state: "decision" | "action" | "fyi") =>
      decisionPresentation({ state, stateLabel: null, unconsumedAnswers: 0 });
    expect(of("decision").label).toBe("Decision needed");
    expect(of("action").label).toBe("Action needed");
    expect(of("fyi").label).toBe("FYI");
  });

  test("an other decision reads its own state label", () => {
    expect(
      decisionPresentation({
        state: "other",
        stateLabel: "Watching",
        unconsumedAnswers: 0,
      }).label,
    ).toBe("Watching");
  });

  test("an answer the agent has not acted on reads Sent, until closed", () => {
    expect(
      decisionPresentation({
        state: "decision",
        stateLabel: null,
        unconsumedAnswers: 1,
      }).label,
    ).toBe("Sent");
    expect(
      decisionPresentation({
        state: "closed",
        stateLabel: null,
        unconsumedAnswers: 1,
      }).label,
    ).toBe("Closed");
  });
});
