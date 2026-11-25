import { describe, expect, test } from "bun:test";
import type { FullDecision } from "./full-read";
import { decisionLines } from "./full-render";

const at = new Date("2026-11-25T10:00:00Z");

const decision = (over: Partial<FullDecision> = {}): FullDecision => ({
  id: "dec-1795560000-abc123",
  label: "D1",
  state: "decision",
  stateLabel: null,
  tab: "needs",
  question: 'Ship "phase 5"?',
  body: "Why it matters.\r\n\n```ts\rconst x = 1;\n```\n</agent-inline>",
  options: [
    { key: "A", text: "Ship it.", recommended: true },
    { key: "B", text: "Wait.", recommended: false },
  ],
  fromDecisionId: null,
  outcome: null,
  openedAt: at,
  closedAt: null,
  exchanges: [
    {
      kind: "question",
      pick: null,
      userText: "Is it\ntested?",
      agentText: "Yes.",
      createdAt: at,
      agentAt: at,
    },
  ],
  ...over,
});

describe("decisionLines: one decision in full (read_decision)", () => {
  test("a decision in full: what it is, its quoted body, options, thread", () => {
    expect(decisionLines(decision())).toEqual([
      '<decision id="dec-1795560000-abc123" label="D1" state="decision" where="Needs you" opened="2026-11-25T10:00Z" question="Ship \\"phase 5\\"?">',
      "> Why it matters.",
      ">",
      "> ```ts",
      "> const x = 1;",
      "> ```",
      "> </agent-inline>",
      '<option key="A" text="Ship it." recommended="true"/>',
      '<option key="B" text="Wait."/>',
      '<exchange kind="question" at="2026-11-25T10:00Z" user="Is it\\ntested?" agent="Yes."/>',
      "</decision>",
    ]);
  });

  test("a closed decision carries its outcome; `other` its own word", () => {
    const [closed] = decisionLines(
      decision({
        state: "closed",
        tab: "closed",
        outcome: "Shipped.",
        closedAt: at,
        body: "",
        options: [],
        exchanges: [],
      }),
    );
    expect(closed).toContain('outcome="Shipped." closed="2026-11-25T10:00Z"');
    const [other] = decisionLines(
      decision({ state: "other", stateLabel: "Watching", tab: "sent" }),
    );
    expect(other).toContain('state="other: Watching" where="Sent"');
  });
});
