import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import {
  tasksView,
  updateTask,
  type DbExecutor,
} from "@plugins/tasks/plugins/tasks-core/server";
import { _supervisorSessionHandoffs } from "./tables";
import { runCarries, type SessionHandoffCarryEntry } from "./carry";

const h = _supervisorSessionHandoffs;

/** A session tree's tasks that are over: they stay in the ended tree. */
const SETTLED_STATUSES = ["done", "dropped"] as const;

/** A pending hand-off, taken by the session launched to receive it. */
export interface TakenHandoff {
  fromTaskId: string;
  handoff: string;
  /** The ended session's open direct children moved under the new root —
   * empty unless the hand-off asked for the move (`moveOpenTasks`). */
  moved: string[];
}

/**
 * Role `roleId`'s pending hand-off, row-locked on `tx` — with the ended
 * session's open (not done / dropped) direct children when it asked for them
 * to move — or `null` when none is pending. Read before the new session's task exists, so its brief can
 * carry it; {@link consumeHandoff} finishes the take on the same transaction.
 */
export async function pendingHandoffOf(
  roleId: string,
  tx: DbExecutor,
): Promise<TakenHandoff | null> {
  const [row] = await tx
    .select({
      fromTaskId: h.fromTaskId,
      handoff: h.handoff,
      moveOpenTasks: h.moveOpenTasks,
    })
    .from(h)
    .where(and(eq(h.roleId, roleId), isNull(h.consumedAt)))
    .for("update");
  if (!row) return null;
  const { moveOpenTasks, ...taken } = row;
  if (!moveOpenTasks) return { ...taken, moved: [] };
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
  return { ...taken, moved: children.map((c) => c.id) };
}

/**
 * Finish taking `taken` into the session rooted at `toTaskId`, on the launch's
 * transaction: the children it lists move under the new root (its tree watch
 * covers them from its first turn), every carry takes over what it carries
 * (`carries`: the registered `SessionHandoff.Carry`s — the open decisions), and the hand-off is stamped
 * consumed. Returns the carries' lines, for the brief.
 */
export async function consumeHandoff(
  taken: TakenHandoff,
  toTaskId: string,
  tx: DbExecutor,
  carries: readonly SessionHandoffCarryEntry[],
): Promise<string[]> {
  for (const id of taken.moved)
    await updateTask(id, { folderId: toTaskId }, tx);
  const carried = await runCarries(carries, taken.fromTaskId, toTaskId, tx);
  await tx
    .update(h)
    .set({ consumedAt: new Date(), toTaskId })
    .where(eq(h.fromTaskId, taken.fromTaskId));
  return carried;
}

/** The hand-off as the new session's brief reads it (after the role's
 * prompt, which every session starts with). */
export function handoffBrief(
  taken: TakenHandoff,
  carried: readonly string[] = [],
): string {
  const moved =
    taken.moved.length === 0
      ? `Its tasks stay in its own tree, under ${taken.fromTaskId}.`
      : `Its open tasks were moved under this session: ${taken.moved.join(", ")}.`;
  return `## Handoff from the previous session\n\nThe previous session of this role (${taken.fromTaskId}) ended and handed its work to you. ${[moved, ...carried].join(" ")} Its note to you:\n\n${taken.handoff.trim()}`;
}
