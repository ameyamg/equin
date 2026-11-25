/**
 * The decisions record against the REAL worktree DB, inside rolled-back
 * transactions (`worktreeDbScenario`): the inbox tab derived from a
 * decision's state and its thread's stored facts (each state × exchange
 * kind), label auto-numbering and uniqueness, the caps, the CHECKs, and the
 * tool rules — ownership, `reply` with no pending question, closing without
 * an outcome, notes on a closed decision accepted, other edits refused,
 * reopening.
 *
 * Run: `./equin test plugins/tasks/plugins/decisions`.
 */
import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  worktreeDbScenario,
  type DbExecutor,
} from "@plugins/database/plugins/db-test-fixture/plugins/worktree-db/server/testing";
import {
  conversationIdKind,
  taskIdKind,
  type TaskId,
} from "@plugins/tasks/plugins/task-ids/core";
import {
  decisionExchangeIdKind,
  DECISIONS_PER_TASK_MAX,
  EXCHANGES_PER_DECISION_MAX,
  type DecisionId,
  type DecisionTab,
} from "../../core";
import type { ExchangeKind } from "../../core/internal/fields";
import { readDecisionInFull } from "./full-read";
import { renderDecisionList } from "./render";
import {
  listTaskDecisions,
  openDecision,
  updateDecision,
  type DecisionCaller,
  type OpenDecisionResult,
} from "./repo";
import { _decisionExchanges, _decisions } from "./tables";

async function task(tx: DbExecutor, title: string): Promise<TaskId> {
  const id = taskIdKind.mint();
  await tx.execute(sql`
    INSERT INTO tasks (id, cluster_id, title, title_auto, rank, folder_id, created_at, updated_at, mandate_ref, author_kind)
    VALUES (${id}, ${id}, ${title}, false, ${id}, NULL, now(), now(), 'interactive', 'human')
  `);
  return id;
}

async function caller(
  tx: DbExecutor,
  title = "Agent",
): Promise<DecisionCaller> {
  return {
    taskId: await task(tx, title),
    conversationId: conversationIdKind.mint(),
  };
}

function opened(out: OpenDecisionResult): { id: DecisionId; label: string } {
  if (!out.ok) throw new Error(`open refused: ${out.message}`);
  return out;
}

const open = async (
  tx: DbExecutor,
  c: DecisionCaller,
  extra: Partial<Parameters<typeof openDecision>[2]> = {},
) =>
  opened(
    await openDecision(tx, c, {
      state: "decision",
      question: "Cache the homepage?",
      options: [
        { key: "A", text: "Cache it.", recommended: true },
        { key: "B", text: "Do not." },
      ],
      ...extra,
    }),
  );

async function exchange(
  tx: DbExecutor,
  decisionId: DecisionId,
  kind: ExchangeKind,
  extra: Partial<typeof _decisionExchanges.$inferInsert> = {},
): Promise<void> {
  await tx.insert(_decisionExchanges).values({
    id: decisionExchangeIdKind.mint(),
    decisionId,
    kind,
    pick: kind === "answer" ? "A" : null,
    userText: kind === "update" ? null : "a note",
    agentText: kind === "update" ? "noted" : null,
    agentAt: kind === "update" ? new Date() : null,
    turnId: null,
    consumedAt: null,
    ...extra,
  });
}

async function tabOf(tx: DbExecutor, c: DecisionCaller, id: DecisionId) {
  const rows = await listTaskDecisions(tx, c.taskId, { all: true });
  const row = rows.find((r) => r.id === id);
  if (row === undefined) throw new Error(`${id} not listed`);
  return row;
}

describe("decisions: the inbox tab", () => {
  test("each state × each exchange kind", async () => {
    await worktreeDbScenario(async (tx) => {
      const c = await caller(tx);
      const cases: {
        state: "decision" | "action" | "fyi" | "other";
        kind: ExchangeKind | null;
        tab: DecisionTab;
      }[] = [];
      for (const state of ["decision", "action", "fyi", "other"] as const)
        for (const kind of [
          null,
          "answer",
          "question",
          "update",
          "recorded",
        ] as const) {
          const expected: DecisionTab =
            state === "other" || kind === "answer"
              ? "sent"
              : state === "fyi"
                ? "fyi"
                : "needs";
          cases.push({ state, kind, tab: expected });
        }
      for (const k of cases) {
        const d = await open(tx, c, {
          state: k.state,
          ...(k.state === "other" ? { stateLabel: "Watching" } : {}),
        });
        if (k.kind !== null) await exchange(tx, d.id, k.kind);
        expect([k.state, k.kind, (await tabOf(tx, c, d.id)).tab]).toEqual([
          k.state,
          k.kind,
          k.tab,
        ]);
      }
    });
  });

  test("a consumed answer leaves Sent; a closed decision is Closed whatever its thread", async () => {
    await worktreeDbScenario(async (tx) => {
      const c = await caller(tx);
      const d = await open(tx, c);
      await exchange(tx, d.id, "answer");
      await exchange(tx, d.id, "question");
      expect((await tabOf(tx, c, d.id)).tab).toBe("sent");
      expect((await tabOf(tx, c, d.id)).pendingQuestions).toBe(1);
      const r = await updateDecision(tx, c, {
        decision: d.label,
        reply: "Because.",
      });
      expect(r.ok && r.consumed).toEqual({ answers: 1, question: true });
      const after = await tabOf(tx, c, d.id);
      expect([after.tab, after.pendingQuestions]).toEqual(["needs", 0]);
      await exchange(tx, d.id, "answer");
      const closed = await updateDecision(tx, c, {
        decision: d.id,
        state: "closed",
        outcome: "A",
      });
      expect(closed.ok && closed.transition).toBe("closed");
      // Closing is an update: the answer is consumed too.
      expect((await tabOf(tx, c, d.id)).tab).toBe("closed");
      await exchange(tx, d.id, "answer");
      expect((await tabOf(tx, c, d.id)).tab).toBe("closed");
    });
  });
});

describe("decisions: labels", () => {
  test("auto-numbered D<n> past the highest, unique per task, free across tasks", async () => {
    await worktreeDbScenario(async (tx) => {
      const c = await caller(tx);
      expect((await open(tx, c)).label).toBe("D1");
      expect((await open(tx, c, { label: "D7" })).label).toBe("D7");
      expect((await open(tx, c, { label: "D7a" })).label).toBe("D7a");
      expect((await open(tx, c)).label).toBe("D8");
      const taken = await openDecision(tx, c, {
        state: "fyi",
        question: "q",
        label: "D7",
      });
      expect(!taken.ok && taken.reason).toBe("label-taken");
      const looksLikeId = await openDecision(tx, c, {
        state: "fyi",
        question: "q",
        label: "dec-1795560228-abcdef",
      });
      expect(!looksLikeId.ok && looksLikeId.reason).toBe("label-invalid");
      const other = await caller(tx, "Other");
      expect((await open(tx, other)).label).toBe("D1");
      const rename = await updateDecision(tx, c, {
        decision: "D1",
        label: "D8",
      });
      expect(!rename.ok && rename.reason).toBe("label-taken");
    });
  });

  test("options: unique keys, one sentence, at most one recommended", async () => {
    await worktreeDbScenario(async (tx) => {
      const c = await caller(tx);
      const base = { state: "decision" as const, question: "q" };
      const dup = await openDecision(tx, c, {
        ...base,
        options: [
          { key: "A", text: "x" },
          { key: "A", text: "y" },
        ],
      });
      expect(!dup.ok && dup.reason).toBe("options-invalid");
      const two = await openDecision(tx, c, {
        ...base,
        options: [
          { key: "A", text: "x", recommended: true },
          { key: "B", text: "y", recommended: true },
        ],
      });
      expect(!two.ok && two.reason).toBe("options-invalid");
      const lines = await openDecision(tx, c, {
        ...base,
        options: [{ key: "A", text: "x\ny" }],
      });
      expect(!lines.ok && lines.reason).toBe("options-invalid");
      const other = await openDecision(tx, c, {
        state: "other",
        question: "q",
      });
      expect(!other.ok && other.reason).toBe("state-label");
      const stray = await openDecision(tx, c, {
        state: "fyi",
        question: "q",
        stateLabel: "Watching",
      });
      expect(!stray.ok && stray.reason).toBe("state-label");
    });
  });
});

describe("decisions: caps and CHECKs", () => {
  test("a task holds at most DECISIONS_PER_TASK_MAX decisions", async () => {
    await worktreeDbScenario(async (tx) => {
      const c = await caller(tx);
      await tx.insert(_decisions).values(
        Array.from({ length: DECISIONS_PER_TASK_MAX }, (_, i) => ({
          id: `dec-${1795560228 + i}-capcap` as DecisionId,
          taskId: c.taskId,
          openedByConversationId: c.conversationId,
          label: `X${i}`,
          state: "fyi" as const,
          stateLabel: null,
          question: "q",
          outcome: null,
          closedAt: null,
          seenAt: null,
          fromDecisionId: null,
        })),
      );
      const out = await openDecision(tx, c, { state: "fyi", question: "q" });
      expect(!out.ok && out.reason).toBe("too-many-decisions");
    });
  });

  test("a thread holds at most EXCHANGES_PER_DECISION_MAX exchanges", async () => {
    await worktreeDbScenario(async (tx) => {
      const c = await caller(tx);
      const d = await open(tx, c);
      for (let i = 0; i < EXCHANGES_PER_DECISION_MAX; i++)
        await exchange(tx, d.id, "update");
      const out = await updateDecision(tx, c, {
        decision: d.label,
        update: "one more",
      });
      expect(!out.ok && out.reason).toBe("too-many-exchanges");
    });
  });

  test("the table refuses a closed decision without an outcome and an `other` without a label", async () => {
    for (const set of [
      { state: "closed" as const, closedAt: new Date() },
      { outcome: "x" },
      { state: "other" as const },
      { stateLabel: "Watching" },
      { state: "closed" as const, outcome: "x" },
    ]) {
      const err = await worktreeDbScenario(async (tx) => {
        const c = await caller(tx);
        const d = await open(tx, c);
        await tx.execute(sql`SAVEPOINT s`);
        try {
          await tx.update(_decisions).set(set).where(eq(_decisions.id, d.id));
          return null;
        } catch (e) {
          await tx.execute(sql`ROLLBACK TO SAVEPOINT s`);
          return String((e as { cause?: unknown }).cause ?? e);
        }
      });
      expect(err).toContain("check constraint");
    }
  });
});

describe("decisions: update rules", () => {
  test("only the owning task updates; another task may only name it as `from`", async () => {
    await worktreeDbScenario(async (tx) => {
      const owner = await caller(tx, "Owner");
      const other = await caller(tx, "Other");
      const d = await open(tx, owner);
      const byId = await updateDecision(tx, other, {
        decision: d.id,
        update: "x",
      });
      expect(!byId.ok && byId.reason).toBe("not-yours");
      expect(!byId.ok && byId.message).toContain(owner.taskId);
      // A label resolves within the caller's own task only.
      const byLabel = await updateDecision(tx, other, {
        decision: d.label,
        update: "x",
      });
      expect(!byLabel.ok && byLabel.reason).toBe("unknown-decision");
      const child = await open(tx, other, { from: d.id });
      const [row] = await tx
        .select({ from: _decisions.fromDecisionId })
        .from(_decisions)
        .where(eq(_decisions.id, child.id));
      expect(row?.from).toBe(d.id);
      const dangling = await openDecision(tx, other, {
        state: "fyi",
        question: "q",
        from: "D99",
      });
      expect(!dangling.ok && dangling.reason).toBe("unknown-from");
    });
  });

  test("reply needs a pending question; closing needs an outcome; outcome needs a close; an empty call is refused", async () => {
    await worktreeDbScenario(async (tx) => {
      const c = await caller(tx);
      const d = await open(tx, c);
      const reply = await updateDecision(tx, c, {
        decision: d.label,
        reply: "x",
      });
      expect(!reply.ok && reply.reason).toBe("no-pending-question");
      const close = await updateDecision(tx, c, {
        decision: d.label,
        state: "closed",
      });
      expect(!close.ok && close.reason).toBe("close-needs-outcome");
      const outcome = await updateDecision(tx, c, {
        decision: d.label,
        outcome: "A",
      });
      expect(!outcome.ok && outcome.reason).toBe("outcome-without-close");
      const empty = await updateDecision(tx, c, { decision: d.label });
      expect(!empty.ok && empty.reason).toBe("nothing-to-update");
      // Two questions: replies fill them oldest first.
      await exchange(tx, d.id, "question", {
        userText: "first",
        createdAt: new Date(1),
      });
      await exchange(tx, d.id, "question", {
        userText: "second",
        createdAt: new Date(2),
      });
      await updateDecision(tx, c, { decision: d.label, reply: "to first" });
      const thread = await tx
        .select()
        .from(_decisionExchanges)
        .where(eq(_decisionExchanges.decisionId, d.id));
      const byText = Object.fromEntries(
        thread.map((x) => [x.userText, x.agentText]),
      );
      expect(byText).toEqual({ first: "to first", second: null });
    });
  });

  test("a closed decision takes notes and replies; other edits are refused unless the call reopens it", async () => {
    await worktreeDbScenario(async (tx) => {
      const c = await caller(tx);
      const d = await open(tx, c);
      await exchange(tx, d.id, "question");
      const closed = await updateDecision(tx, c, {
        decision: d.label,
        state: "closed",
        outcome: "A: cache 10 s",
      });
      expect(closed.ok).toBe(true);
      const note = await updateDecision(tx, c, {
        decision: d.label,
        update: "Pushed a1b2c3",
      });
      expect(note.ok && note.state).toBe("closed");
      const reply = await updateDecision(tx, c, {
        decision: d.label,
        reply: "Because.",
      });
      expect(reply.ok && reply.consumed.question).toBe(true);
      for (const edit of [
        { question: "changed?" },
        { options: [{ key: "C", text: "New." }] },
        { outcome: "B" },
        { state: "closed" as const, outcome: "B" },
        { label: "D9" },
      ]) {
        const out = await updateDecision(tx, c, { decision: d.label, ...edit });
        expect([Object.keys(edit).join(), !out.ok && out.reason]).toEqual([
          Object.keys(edit).join(),
          "closed-edit",
        ]);
      }
      const reopen = await updateDecision(tx, c, {
        decision: d.label,
        state: "decision",
        question: "Cache for 30 s instead?",
      });
      expect(reopen.ok && reopen.transition).toBe("reopened");
      const [row] = await tx
        .select()
        .from(_decisions)
        .where(eq(_decisions.id, d.id));
      expect([row?.state, row?.outcome, row?.closedAt, row?.question]).toEqual([
        "decision",
        null,
        null,
        "Cache for 30 s instead?",
      ]);
      const reopenWithOutcome = await updateDecision(tx, c, {
        decision: d.label,
        state: "closed",
        outcome: "C",
      });
      expect(reopenWithOutcome.ok).toBe(true);
      const bad = await updateDecision(tx, c, {
        decision: d.label,
        state: "fyi",
        outcome: "x",
      });
      expect(!bad.ok && bad.reason).toBe("outcome-without-close");
    });
  });

  test("an `other` keeps its label until the state moves off it", async () => {
    await worktreeDbScenario(async (tx) => {
      const c = await caller(tx);
      const d = await open(tx, c, { state: "other", stateLabel: "Watching" });
      expect(
        (await updateDecision(tx, c, { decision: d.label, body: "x" })).ok,
      ).toBe(true);
      const moved = await updateDecision(tx, c, {
        decision: d.label,
        state: "action",
      });
      expect(moved.ok).toBe(true);
      const [row] = await tx
        .select()
        .from(_decisions)
        .where(eq(_decisions.id, d.id));
      expect(row?.stateLabel).toBeNull();
    });
  });
});

describe("decisions: list_decisions", () => {
  test("one line per open decision, with what the user last sent; closed ones counted", async () => {
    const text = await worktreeDbScenario(async (tx) => {
      const c = await caller(tx);
      const a = await open(tx, c);
      await exchange(tx, a.id, "answer", { userText: "keep it short" });
      const b = await open(tx, c, {
        state: "fyi",
        question: "FYI: deploy at 3",
      });
      await updateDecision(tx, c, {
        decision: b.label,
        state: "closed",
        outcome: "Seen",
      });
      const rows = await listTaskDecisions(tx, c.taskId, { all: false });
      return renderDecisionList(rows, { hiddenClosed: 1 });
    });
    expect(text).toContain("D1 (dec-");
    expect(text).toContain(
      '· decision · Sent — Cache the homepage? · user last picked A: "keep it short"',
    );
    expect(text).not.toContain("D2");
    expect(text).toContain("+1 closed");
  });
});

describe("decisions: read_decision's read", () => {
  test("any task's decision in full by id, with its task; an unknown id reads null", async () => {
    const [full, missing, taskId] = await worktreeDbScenario(async (tx) => {
      const c = await caller(tx);
      const a = await open(tx, c, { body: "Context." });
      await exchange(tx, a.id, "answer", { userText: "keep it short" });
      return [
        await readDecisionInFull(a.id, tx),
        await readDecisionInFull("dec-1795560000-nonexx" as DecisionId, tx),
        c.taskId,
      ] as const;
    });
    expect(full?.taskId).toBe(taskId);
    expect(full?.body).toBe("Context.");
    expect(full?.tab).toBe("sent");
    expect(full?.exchanges.map((e) => e.userText)).toEqual(["keep it short"]);
    expect(missing).toBeNull();
  });
});

describe("decisions: the dry run the tool checks with", () => {
  test("says what the call would do and writes nothing", async () => {
    await worktreeDbScenario(async (tx) => {
      const c = await caller(tx);
      const d = await open(tx, c);
      await updateDecision(tx, c, {
        decision: d.label,
        state: "closed",
        outcome: "A",
      });
      await exchange(tx, d.id, "answer");
      const refused = await updateDecision(
        tx,
        c,
        { decision: d.label, state: "other" },
        { dryRun: true },
      );
      expect(!refused.ok && refused.reason).toBe("state-label");
      const check = await updateDecision(
        tx,
        c,
        { decision: d.label, state: "decision" },
        { dryRun: true },
      );
      expect(check.ok && check.transition).toBe("reopened");
      const [row] = await tx
        .select()
        .from(_decisions)
        .where(eq(_decisions.id, d.id));
      expect([row?.state, row?.outcome]).toEqual(["closed", "A"]);
      expect((await tabOf(tx, c, d.id)).tab).toBe("closed");
      const thread = await tx
        .select()
        .from(_decisionExchanges)
        .where(eq(_decisionExchanges.decisionId, d.id));
      expect(thread.filter((x) => x.consumedAt === null)).toHaveLength(1);
    });
  });
});
