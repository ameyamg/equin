/**
 * Taking a hand-off against the REAL worktree DB, inside rolled-back
 * transactions: the ended session's open children move under the new root,
 * settled ones stay, and the hand-off is consumed (so no second launch takes
 * it).
 *
 * Run: `./equin test plugins/tasks/plugins/supervisor-roles/plugins/sessions`.
 */
import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import {
  worktreeDbScenario,
  type DbExecutor,
} from "@plugins/database/plugins/db-test-fixture/plugins/worktree-db/server/testing";
import { consumeHandoff, handoffBrief, pendingHandoffOf } from "./handoff-take";

let seq = 0;
const uid = (k: string) => `${k}-ho${Date.now()}-${++seq}`;

async function task(
  tx: DbExecutor,
  opts: { folderId: string | null; mandate: string | null; dropped?: boolean },
): Promise<string> {
  const id = uid("task");
  await tx.execute(sql`
    INSERT INTO tasks (id, cluster_id, title, title_auto, rank, folder_id, created_at, updated_at, mandate_ref, author_kind, dropped_at)
    VALUES (${id}, ${opts.folderId ?? id}, 'T', true, ${id}, ${opts.folderId}, now(), now(), ${opts.mandate}, 'human', ${opts.dropped ? new Date() : null})
  `);
  return id;
}

describe("handoff: pendingHandoffOf / consumeHandoff", () => {
  test("moves the open children under the new root and consumes the note", async () => {
    const got = await worktreeDbScenario(async (tx) => {
      const role = uid("srole");
      await tx.execute(
        sql`INSERT INTO supervisor_roles (id, name) VALUES (${role}, ${role})`,
      );
      const oldRoot = await task(tx, {
        folderId: null,
        mandate: "supervisor-role",
      });
      const open = await task(tx, { folderId: oldRoot, mandate: null });
      const settled = await task(tx, {
        folderId: oldRoot,
        mandate: null,
        dropped: true,
      });
      const newRoot = await task(tx, {
        folderId: null,
        mandate: "supervisor-role",
      });
      await tx.execute(sql`
        INSERT INTO supervisor_session_handoffs (from_task_id, role_id, handoff)
        VALUES (${oldRoot}, ${role}, 'Watch the deploy.')`);
      const taken = await pendingHandoffOf(role, tx);
      if (taken === null) throw new Error("expected a pending hand-off");
      await consumeHandoff(taken, newRoot, tx);
      const folders = (
        await tx.execute<{ id: string; folder: string | null }>(
          sql`SELECT id, folder_id AS folder FROM tasks WHERE id IN (${open}, ${settled})`,
        )
      ).rows;
      const again = await pendingHandoffOf(role, tx);
      const [row] = (
        await tx.execute<{ to: string | null }>(
          sql`SELECT to_task_id AS to FROM supervisor_session_handoffs WHERE from_task_id = ${oldRoot}`,
        )
      ).rows;
      return { oldRoot, newRoot, open, settled, taken, folders, again, row };
    });
    expect(got.taken.moved).toEqual([got.open]);
    expect(
      Object.fromEntries(got.folders.map((f) => [f.id, f.folder])),
    ).toEqual({
      [got.open]: got.newRoot,
      [got.settled]: got.oldRoot,
    });
    expect(got.again).toBeNull();
    expect(got.row?.to).toBe(got.newRoot);
    expect(handoffBrief(got.taken)).toContain("Watch the deploy.");
  });
});
