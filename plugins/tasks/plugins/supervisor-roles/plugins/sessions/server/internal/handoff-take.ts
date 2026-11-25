import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import {
  tasksView,
  updateTask,
  type DbExecutor,
} from "@plugins/tasks/plugins/tasks-core/server";
import { _supervisorSessionHandoffs } from "./tables";

const h = _supervisorSessionHandoffs;

/** A session tree's tasks that are over: they stay in the ended tree. */
const SETTLED_STATUSES = ["done", "dropped"] as const;

/** A pending hand-off, taken by the session launched to receive it. */
export interface TakenHandoff {
  fromTaskId: string;
  handoff: string;
  /** The ended session's open direct children, moved under the new root. */
  moved: string[];
}

/**
 * Role `roleId`'s pending hand-off, row-locked on `tx`, with the ended
 * session's open (not done / dropped) direct children — or `null` when none
 * is pending. Read before the new session's task exists, so its brief can
 * carry it; {@link consumeHandoff} finishes the take on the same transaction.
 */
export async function pendingHandoffOf(
  roleId: string,
  tx: DbExecutor,
): Promise<TakenHandoff | null> {
  const [row] = await tx
    .select({ fromTaskId: h.fromTaskId, handoff: h.handoff })
    .from(h)
    .where(and(eq(h.roleId, roleId), isNull(h.consumedAt)))
    .for("update");
  if (!row) return null;
  const children = await tx
    .select({ id: tasksView.id })
    .from(tasksView)
    .where(
      and(
        eq(tasksView.folderId, row.fromTaskId),
        notInArray(tasksView.status, [...SETTLED_STATUSES]),
      ),
    )
    .orderBy(asc(tasksView.rank));
  return { ...row, moved: children.map((c) => c.id) };
}

/**
 * Finish taking `taken` into the session rooted at `toTaskId`, on the launch's
 * transaction: the ended session's open children move under the new root
 * (its tree watch covers them from its first turn), and the hand-off is
 * stamped consumed.
 */
export async function consumeHandoff(
  taken: TakenHandoff,
  toTaskId: string,
  tx: DbExecutor,
): Promise<void> {
  for (const id of taken.moved)
    await updateTask(id, { folderId: toTaskId }, tx);
  await tx
    .update(h)
    .set({ consumedAt: new Date(), toTaskId })
    .where(eq(h.fromTaskId, taken.fromTaskId));
}

/** The hand-off as the new session's brief reads it (after the role's
 * prompt, which every session starts with). */
export function handoffBrief(taken: TakenHandoff): string {
  const moved =
    taken.moved.length === 0
      ? "It left no open tasks."
      : `Its open tasks were moved under this session: ${taken.moved.join(", ")}.`;
  return `## Handoff from the previous session\n\nThe previous session of this role (${taken.fromTaskId}) ended and handed its work to you. ${moved} Its note to you:\n\n${taken.handoff.trim()}`;
}
