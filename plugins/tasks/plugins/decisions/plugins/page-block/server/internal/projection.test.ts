import { describe, expect, test } from "bun:test";
import {
  parseMarkdownToForest,
  serializeForestToMarkdown,
  type BlockHandle,
  type MarkdownContext,
} from "@plugins/page/plugins/editor/core";
import type { FullDecision } from "@plugins/tasks/plugins/decisions/server";
import {
  DECISIONS_PER_TASK_MAX,
  EXCHANGES_PER_DECISION_MAX,
  DECISION_OPTIONS_MAX,
} from "@plugins/tasks/plugins/decisions/core";
import { taskDecisionsBlock } from "../../core";
import {
  BODY_EXCERPT_CHARS,
  RECENT_CLOSED,
  decisionsBody,
  excerpt,
  ownCounts,
  projectTaskDecisions,
} from "./projection";

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
  test("the owner reads a stub; another reader the bounded body; a gone task says so", () => {
    const read = {
      exists: true as const,
      title: "Phase 5",
      decisions: [
        decision(),
        decision({ id: "dec-2", state: "closed", closedAt: at }),
      ],
    };
    expect(ownCounts(read.decisions)).toBe("1 open, 1 closed");
    expect(projectTaskDecisions(read, true)).toEqual({
      attrs: { title: "Phase 5", own: "1 open, 1 closed" },
    });
    const shown = projectTaskDecisions(read, false);
    expect(shown.attrs).toMatchObject({
      title: "Phase 5",
      decisions: "1 open, 1 closed",
    });
    expect(shown.attrs?.shown).toContain("read_decision");
    expect(shown.body?.filter((l) => l.startsWith("<decision "))).toHaveLength(
      2,
    );
    expect(
      projectTaskDecisions({ exists: true, title: "E", decisions: [] }, false),
    ).toEqual({ attrs: { title: "E", decisions: "none" } });
    expect(projectTaskDecisions({ exists: false }, false)).toEqual({
      attrs: { missing: "task deleted" },
    });
  });

  test("an open decision shows a one-line excerpt of its body, its options, its thread's length", () => {
    const body = decisionsBody([decision({ body: "word ".repeat(1000) })]);
    expect(body[0]).toContain('thread="1"');
    const quoted = body.filter((l) => l.startsWith(">"));
    expect(quoted).toHaveLength(1);
    expect(quoted[0]!.length).toBeLessThanOrEqual(BODY_EXCERPT_CHARS + 3);
    expect(quoted[0]!.endsWith("…")).toBe(true);
    expect(body.filter((l) => l.startsWith("<option "))).toHaveLength(2);
    expect(body.some((l) => l.startsWith("<exchange "))).toBe(false);
    expect(excerpt("short\n\n text", 240)).toBe("short text");
  });

  test("most pressing first; the latest closed as lines; every other one named by id", () => {
    const open = (i: number, tab: FullDecision["tab"]) =>
      decision({
        id: `dec-o${i}`,
        label: `D${i}`,
        tab,
        state: tab === "fyi" ? "fyi" : "decision",
        openedAt: new Date(at.getTime() + i * 60_000),
      });
    const closed = (i: number) =>
      decision({
        id: `dec-c${i}`,
        label: `C${i}`,
        state: "closed",
        tab: "closed",
        outcome: "Done.",
        closedAt: new Date(at.getTime() + i * 60_000),
      });
    const body = decisionsBody([
      open(1, "fyi"),
      open(2, "needs"),
      open(3, "sent"),
      ...Array.from({ length: 8 }, (_, i) => closed(i)),
    ]);
    const ids = body
      .filter((l) => l.startsWith("<decision "))
      .map((l) => /id="([^"]+)"/.exec(l)![1]);
    expect(ids).toEqual([
      "dec-o2",
      "dec-o3",
      "dec-o1",
      // the RECENT_CLOSED latest closed, latest first
      ...[7, 6, 5, 4, 3].map((i) => `dec-c${i}`),
      // older closed, named only
      "dec-c2",
      "dec-c1",
      "dec-c0",
    ]);
    expect(RECENT_CLOSED).toBe(5);
    expect(body.at(-1)).toBe(
      '<decision id="dec-c0" label="C0" state="closed"/>',
    );
  });

  test("a task at the record's caps stays under the bound, every id on it", () => {
    const long = (n: number) => "x".repeat(n);
    const decisions = Array.from({ length: DECISIONS_PER_TASK_MAX }, (_, i) =>
      decision({
        id: `dec-1795560000-${String(i).padStart(6, "0")}`,
        label: `D${i}`.padEnd(32, "x"),
        state: i % 2 === 0 ? "other" : "closed",
        stateLabel: i % 2 === 0 ? long(40) : null,
        tab: i % 2 === 0 ? "sent" : "closed",
        question: '"'.repeat(300),
        body: `${"word ".repeat(3_999)}\n`.slice(0, 20_000),
        options: Array.from({ length: DECISION_OPTIONS_MAX }, (_, k) => ({
          key: `K${k}`,
          text: long(240),
          recommended: false,
        })),
        fromDecisionId: "dec-1795560000-zzzzzz",
        outcome: i % 2 === 0 ? null : long(500),
        closedAt: i % 2 === 0 ? null : new Date(at.getTime() + i * 60_000),
        exchanges: Array.from({ length: EXCHANGES_PER_DECISION_MAX }, () => ({
          kind: "question" as const,
          pick: "A",
          userText: long(4_000),
          agentText: long(4_000),
          createdAt: at,
          agentAt: at,
        })),
      }),
    );
    const { body } = projectTaskDecisions(
      { exists: true, title: "Busy", decisions },
      false,
    );
    const chars = body!.join("\n").length;
    // ~330M chars in full (decisionLines over the same decisions), under 30k projected.
    expect(chars).toBeLessThan(30_000);
    for (const d of decisions)
      expect(body!.some((l) => l.includes(`id="${d.id}"`))).toBe(true);
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
