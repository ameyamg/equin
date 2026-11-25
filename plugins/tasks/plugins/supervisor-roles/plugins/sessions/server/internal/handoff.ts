import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@plugins/database/server";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import {
  DEFAULT_MODEL_CHOICE,
  type ModelChoice,
} from "@plugins/conversations/plugins/model-provider/core";
import { TaskStatusSchema } from "@plugins/tasks/plugins/tasks-core/core";
import { isLiveSessionStatus } from "@plugins/tasks/plugins/supervisor-roles/core";
import { getSupervisorRole } from "@plugins/tasks/plugins/supervisor-roles/server";
import { _supervisorSessionHandoffs } from "./tables";
import { openRoleSession } from "./launch";

const h = _supervisorSessionHandoffs;

/**
 * Record (or rewrite, while not yet taken) the hand-off of the session rooted
 * at `fromTaskId`: the role's next launch takes it. Written by the `handoff`
 * tool (`sessions/handoff`) once its exit is allowed.
 */
export async function recordHandoff(row: {
  fromTaskId: string;
  roleId: string;
  handoff: string;
  model: ModelChoice | null;
}): Promise<void> {
  await db
    .insert(h)
    .values(row)
    .onConflictDoUpdate({
      target: h.fromTaskId,
      set: { handoff: row.handoff, model: row.model, createdAt: sql`now()` },
      setWhere: isNull(h.consumedAt),
    });
}

/**
 * A session root ended: launch the next session when it handed off. The
 * launch itself takes the hand-off (`openRoleSession`), so a session another
 * path launched first (an event, a person) received it already and this
 * finds nothing pending.
 */
export const handoffLaunchJob = defineJob({
  name: "supervisor-roles.handoff-launch",
  description:
    "Launches a supervisor role's next session once a session that handed off has ended.",
  hold: "seconds",
  input: z.object({}),
  event: z
    .object({ taskId: z.string(), status: TaskStatusSchema })
    .passthrough(),
  dedup: "none",
  run: async ({ event }) => {
    if (event === undefined || isLiveSessionStatus(event.status)) return;
    const [pending] = await db
      .select({ roleId: h.roleId, model: h.model })
      .from(h)
      .where(and(eq(h.fromTaskId, event.taskId), isNull(h.consumedAt)));
    if (!pending) return;
    const role = await getSupervisorRole(pending.roleId);
    if (!role) throw new Error(`No supervisor role "${pending.roleId}".`);
    await openRoleSession(role, pending.model ?? DEFAULT_MODEL_CHOICE);
  },
});
