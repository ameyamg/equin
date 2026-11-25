import { and, eq, ne } from "drizzle-orm";
import type { DbExecutor } from "@plugins/database/server";
import type { TaskId } from "@plugins/tasks/plugins/task-ids/core";
import { _decisions } from "./tables";

/**
 * Move every open (not closed) decision of `fromTaskId` to `toTaskId`, on
 * the caller's transaction — a session handing its work to a successor (a
 * supervisor's `handoff`): the user's answers then go to the successor's
 * agent, and its decision tools address them by label. `toTaskId` must hold
 * no decision yet (a fresh session's root), so every label stays free. The
 * closed ones stay with the task that settled them. Returns the moved labels,
 * in label order.
 */
export async function handOverDecisions(
  fromTaskId: TaskId,
  toTaskId: TaskId,
  tx: DbExecutor,
): Promise<string[]> {
  const moved = await tx
    .update(_decisions)
    .set({ taskId: toTaskId })
    .where(
      and(eq(_decisions.taskId, fromTaskId), ne(_decisions.state, "closed")),
    )
    .returning({ label: _decisions.label });
  return moved
    .map((d) => d.label)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}
