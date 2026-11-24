/**
 * The `decisions.list` window as it ships — the real declaration compiled
 * with the served bindings against the REAL worktree DB, inside a rolled-back
 * transaction: `tab`, the thread facts (a decision with no exchange reads the
 * rollup's defaults), `taskTitle` and `isNew` per row.
 *
 * Run: `./equin test plugins/tasks/plugins/decisions`.
 */
import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { worktreeDbScenario } from "@plugins/database/plugins/db-test-fixture/plugins/worktree-db/server/testing";
import type { QueryDb } from "@plugins/network/plugins/live/plugins/query-resource/server";
import { compileWindowQuery } from "@plugins/network/plugins/live/plugins/query-resource/server/testing";
import { compileCollection } from "@plugins/network/plugins/live/server/testing";
import {
  conversationIdKind,
  taskIdKind,
} from "@plugins/tasks/plugins/task-ids/core";
import { decisionExchangeIdKind, decisionsList } from "../../core";
import { openDecision } from "./repo";
import { decisionsListServeOptions } from "./resources";
import { _decisionExchanges, _decisions } from "./tables";

describe("decisions.list", () => {
  test("tab, facts, task title and the new mark, read through the served window", async () => {
    const rows = await worktreeDbScenario(async (tx) => {
      const taskId = taskIdKind.mint();
      await tx.execute(sql`
        INSERT INTO tasks (id, cluster_id, title, title_auto, rank, created_at, updated_at, mandate_ref, author_kind)
        VALUES (${taskId}, ${taskId}, 'The agent', false, ${taskId}, now(), now(), 'interactive', 'human')`);
      const caller = { taskId, conversationId: conversationIdKind.mint() };
      const open = async (question: string) => {
        const out = await openDecision(tx, caller, {
          state: "decision",
          question,
        });
        if (!out.ok) throw new Error(out.message);
        return out.id;
      };
      const bare = await open("bare");
      const answered = await open("answered");
      const seen = await open("seen, then replied to");
      const seenQuiet = await open("seen, nothing since");
      await tx.insert(_decisionExchanges).values({
        id: decisionExchangeIdKind.mint(),
        decisionId: answered,
        kind: "answer",
        pick: "A",
        userText: null,
        agentText: null,
        agentAt: null,
        turnId: null,
        consumedAt: null,
      });
      const past = new Date(Date.now() - 60_000);
      await tx
        .update(_decisions)
        .set({ seenAt: past })
        .where(eq(_decisions.id, seen));
      await tx
        .update(_decisions)
        .set({ seenAt: new Date() })
        .where(eq(_decisions.id, seenQuiet));
      await tx.insert(_decisionExchanges).values({
        id: decisionExchangeIdKind.mint(),
        decisionId: seen,
        kind: "question",
        pick: null,
        userText: "why?",
        agentText: "because",
        agentAt: new Date(),
        turnId: null,
        consumedAt: null,
      });
      const specs = compileCollection(decisionsList, {
        ...decisionsListServeOptions,
        db: tx as unknown as QueryDb,
      });
      const rowsLoader = compileWindowQuery(decisionsList.rows, specs.rows)
        .serverOpts.loader;
      const ids = [bare, answered, seen, seenQuiet];
      const out = (await rowsLoader(
        decisionsList.rows.point.encode(ids) as never,
      )) as unknown;
      return { ids, out };
    });
    const byId = new Map(
      (rows.out as ReadonlyArray<Record<string, unknown>>).map((r) => [
        r.id,
        r,
      ]),
    );
    const pick = (id: string) => {
      const r = byId.get(id);
      if (r === undefined) throw new Error(`${id} not served`);
      return [
        r.tab,
        r.unconsumedAnswers,
        r.pendingQuestions,
        r.isNew,
        r.taskTitle,
      ];
    };
    const [bare, answered, seen, seenQuiet] = rows.ids;
    expect(pick(bare!)).toEqual(["needs", 0, 0, true, "The agent"]);
    expect(pick(answered!)).toEqual(["sent", 1, 0, true, "The agent"]);
    expect(pick(seen!)).toEqual(["needs", 0, 0, true, "The agent"]);
    expect(pick(seenQuiet!)).toEqual(["needs", 0, 0, false, "The agent"]);
  });
});
