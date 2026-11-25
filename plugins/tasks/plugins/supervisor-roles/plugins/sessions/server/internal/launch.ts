import { db } from "@plugins/database/server";
import { asPluginId } from "@plugins/framework/plugins/plugin-id/core";
import {
  assertChoiceLaunchable,
  DEFAULT_MODEL_CHOICE,
  type ModelChoice,
} from "@plugins/conversations/plugins/model-provider/core";
import { getModelCatalog } from "@plugins/conversations/plugins/model-provider/plugins/catalog/server";
import { HttpError, implement } from "@plugins/infra/plugins/endpoints/server";
import {
  createTask,
  updateTask,
} from "@plugins/tasks/plugins/tasks-core/server";
import { armTaskAutoStart } from "@plugins/tasks/server";
import {
  supervisorRoleMandate,
  type SupervisorRole,
} from "@plugins/tasks/plugins/supervisor-roles/core";
import {
  getSupervisorRole,
  liveSessionOf,
  lockRoleSessions,
  setTaskSupervisorRole,
} from "@plugins/tasks/plugins/supervisor-roles/server";
import { adoptBacklogTask, launchRoleSession } from "../../core";
import { adoptIntoSession, adoptRefusalMessage } from "./adopt";
import { consumeHandoff, handoffBrief, pendingHandoffOf } from "./handoff-take";
import { handoffCarries } from "./carry";

async function roleOr404(id: string): Promise<SupervisorRole> {
  const role = await getSupervisorRole(id);
  if (!role) throw new HttpError(404, `No supervisor role "${id}".`);
  return role;
}

/**
 * Open `role`'s live session, launching one when none is live: a root task
 * stating the supervisor-role mandate, owned by the role, its brief the
 * role's prompt, then the role's pending hand-off (`handoff`: the previous
 * session's note, its open tasks moved under the new root — taken by
 * whichever launch comes first), then `brief`, when given (what the launch is
 * for, e.g. the events that woke it); armed with `model`. A live session found
 * instead is left as it is: `brief` only briefs a session this call launches,
 * and a pending hand-off waits for the next launch.
 */
export async function openRoleSession(
  role: SupervisorRole,
  model: ModelChoice,
  brief?: string,
): Promise<{ taskId: string; started: boolean }> {
  assertChoiceLaunchable(model, getModelCatalog());
  const opened = await db.transaction(async (tx) => {
    // One live session per role: concurrent launches of one role
    // serialize here, and the second finds the first.
    await lockRoleSessions(role.id, tx);
    const live = await liveSessionOf(role.id, tx);
    // A live session that never ran (`new`) is (re)armed below: an arm
    // that failed after its launch committed would otherwise hold the
    // role's one session slot forever.
    if (live)
      return { taskId: live.id, started: false, arm: live.status === "new" };
    const handoff = await pendingHandoffOf(role.id, tx);
    const promptOf = (handoffPart: string) => {
      const p = [role.prompt.trim(), handoffPart, brief?.trim() ?? ""]
        .filter((part) => part !== "")
        .join("\n\n");
      return p === "" ? null : p;
    };
    const task = await createTask(
      {
        mandate: supervisorRoleMandate,
        title: `${role.name} session`,
        titleAuto: false,
        // With a hand-off, rewritten below once its carries said what they
        // took (they need the new root to exist).
        description: promptOf(""),
        filing: {
          author: { kind: "human" },
          filedFrom: asPluginId("tasks.supervisor-roles.sessions"),
        },
      },
      tx,
    );
    await setTaskSupervisorRole(task.id, role.id, tx);
    if (handoff !== null) {
      const carried = await consumeHandoff(
        handoff,
        task.id,
        tx,
        handoffCarries(),
      );
      await updateTask(
        task.id,
        { description: promptOf(handoffBrief(handoff, carried)) },
        tx,
      );
    }
    return { taskId: task.id, started: true, arm: true };
  });
  // After the commit: the launcher it wakes must see the task.
  if (opened.arm)
    await armTaskAutoStart({
      taskId: opened.taskId,
      model,
      armedFrom: asPluginId("tasks.supervisor-roles.sessions"),
    });
  return { taskId: opened.taskId, started: opened.started };
}

export const handleLaunchRoleSession = implement(
  launchRoleSession,
  async ({ params, body }) =>
    openRoleSession(
      await roleOr404(params.id),
      body.model ?? DEFAULT_MODEL_CHOICE,
    ),
);

export const handleAdoptBacklogTask = implement(
  adoptBacklogTask,
  async ({ params, body }) => {
    const role = await roleOr404(params.id);
    const model = body.model ?? DEFAULT_MODEL_CHOICE;
    const session = await openRoleSession(role, model);
    const adopted = await adoptIntoSession({
      taskId: params.taskId,
      roleId: role.id,
      rootTaskId: session.taskId,
      start: { kind: "armed", model },
    });
    if (!adopted.ok)
      throw new HttpError(
        409,
        adoptRefusalMessage(
          params.taskId,
          adopted.refusal,
          `${role.name}'s backlog any more`,
        ),
      );
    return { sessionTaskId: session.taskId, sessionStarted: session.started };
  },
);
