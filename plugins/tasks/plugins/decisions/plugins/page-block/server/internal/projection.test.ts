import { describe, expect, test } from "bun:test";
import {
  parseMarkdownToForest,
  serializeForestToMarkdown,
  type BlockHandle,
  type MarkdownContext,
} from "@plugins/page/plugins/editor/core";
import type { FullDecision } from "@plugins/tasks/plugins/decisions/server";
import { taskDecisionsBlock } from "../../core";
import { decisionLines, ownCounts, projectTaskDecisions } from "./projection";

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

const ctx: MarkdownContext = {
  handles: [taskDecisionsBlock as BlockHandle<unknown>],
  protectedSpans: [],
  blankLines: "empty-block",
  emptyBlocks: "pinned",
  softBreaks: "escaped",
};

const TASK = "task-1795560312-xbwyem";

describe("<task-decisions> projection", () => {
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

  test("the owner reads a stub; another reader every decision; a gone task says so", () => {
    const read = {
      exists: true as const,
      title: "Phase 5",
      decisions: [decision(), decision({ id: "dec-2", state: "closed" })],
    };
    expect(ownCounts(read.decisions)).toBe("1 open, 1 closed");
    expect(projectTaskDecisions(read, true)).toEqual({
      attrs: { title: "Phase 5", own: "1 open, 1 closed" },
    });
    const full = projectTaskDecisions(read, false);
    expect(full.attrs).toEqual({ title: "Phase 5" });
    expect(full.body?.filter((l) => l.startsWith("<decision "))).toHaveLength(
      2,
    );
    expect(projectTaskDecisions({ exists: false }, false)).toEqual({
      attrs: { missing: "task deleted" },
    });
  });

  test("both projections serialize, and parse back to the bare block", () => {
    const read = { exists: true as const, title: "P", decisions: [decision()] };
    const bare = [
      {
        type: "task-decisions",
        data: { taskId: TASK },
        expanded: true,
        children: [],
      },
    ];
    for (const isOwner of [true, false]) {
      const { attrs, body } = projectTaskDecisions(read, isOwner);
      const md = serializeForestToMarkdown(
        [
          {
            type: "task-decisions",
            data: { taskId: TASK },
            expanded: true,
            children: [],
            ...(attrs === undefined ? {} : { annotations: attrs }),
            ...(body === undefined ? {} : { derivedBody: body }),
          },
        ],
        ctx,
      );
      expect(parseMarkdownToForest(md, ctx)).toEqual(bare);
    }
  });

  test("parse refuses a task attribute that is not a task id", () => {
    expect(() =>
      parseMarkdownToForest('<task-decisions task="nope"/>', ctx),
    ).toThrow(/must be a task id/);
  });
});
