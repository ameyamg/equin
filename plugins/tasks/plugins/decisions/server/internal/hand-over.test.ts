/**
 * Handing a task's decisions to a successor session, against the REAL
 * worktree DB inside a rolled-back transaction: the open ones move with their
 * labels, the closed ones stay.
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
import { handOverDecisions } from "./hand-over";
import { openDecision, updateDecision, type DecisionCaller } from "./repo";
import { _decisions } from "./tables";

async function task(tx: DbExecutor): Promise<TaskId> {
  const id = taskIdKind.mint();
  await tx.execute(sql`
    INSERT INTO tasks (id, cluster_id, title, title_auto, rank, folder_id, created_at, updated_at, mandate_ref, author_kind)
    VALUES (${id}, ${id}, 'Session', false, ${id}, NULL, now(), now(), 'interactive', 'human')
  `);
  return id;
}

async function open(tx: DbExecutor, c: DecisionCaller): Promise<string> {
  const out = await openDecision(tx, c, {
    state: "decision",
    question: "Cache the homepage?",
    options: [
      { key: "A", text: "Cache it.", recommended: true },
      { key: "B", text: "Do not." },
    ],
  });
  if (!out.ok) throw new Error(`open refused: ${out.message}`);
  return out.label;
}

describe("handOverDecisions", () => {
  test("moves the open decisions with their labels and leaves the closed ones", async () => {
    const got = await worktreeDbScenario(async (tx) => {
      const from: DecisionCaller = {
        taskId: await task(tx),
        conversationId: conversationIdKind.mint(),
      };
      const to = await task(tx);
      const d1 = await open(tx, from);
      const d2 = await open(tx, from);
      const closed = await updateDecision(tx, from, {
        decision: d2,
        state: "closed",
        outcome: "Cached.",
      });
      if (!closed.ok) throw new Error(`close refused: ${closed.message}`);
      const d3 = await open(tx, from);
      const moved = await handOverDecisions(from.taskId, to, tx);
      const owners = await tx
        .select({ label: _decisions.label, taskId: _decisions.taskId })
        .from(_decisions)
        .where(eq(_decisions.taskId, to));
      return { d1, d2, d3, moved, owners, to };
    });
    expect(got.moved).toEqual([got.d1, got.d3]);
    expect(got.owners.map((o) => o.label).sort()).toEqual([got.d1, got.d3]);
  });
});
