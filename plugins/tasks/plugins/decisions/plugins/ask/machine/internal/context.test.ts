import { describe, expect, test } from "bun:test";
import { renderDecisionAskContext, type DecisionAskContext } from "./context";

const base: DecisionAskContext = {
  decisionId: "dec-1-abc",
  decisionLines: [
    '<decision id="dec-1-abc" label="D1">',
    "> body",
    "</decision>",
  ],
  taskId: "task-1-abc",
  askedBy: "conv-1-abc",
  transcriptPaths: ["/p/a.jsonl", "/p/b.jsonl"],
  tree: "- task-1-abc Root (you)\n  - task-2-abc Worker",
  checkout: "/repo",
};

describe("renderDecisionAskContext", () => {
  test("holds the decision, its transcripts in order, the tree and the checkout", () => {
    const text = renderDecisionAskContext(base);
    expect(text).toContain('<decision id="dec-1-abc" label="D1">');
    expect(text.indexOf("/p/a.jsonl")).toBeLessThan(text.indexOf("/p/b.jsonl"));
    expect(text).toContain("task-2-abc Worker");
    expect(text).toContain("opened by conversation `conv-1-abc`");
    expect(text).toContain("tasks_ext_outcome_report");
    expect(text).toContain("`/repo`");
  });

  test("says so when there is no transcript and no tree", () => {
    const text = renderDecisionAskContext({
      ...base,
      transcriptPaths: [],
      tree: null,
    });
    expect(text).toContain("No transcript on disk");
    expect(text).toContain("asking conversation is gone");
  });
});
