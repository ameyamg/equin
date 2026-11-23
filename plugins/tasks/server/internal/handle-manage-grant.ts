import { HttpError, implement } from "@plugins/infra/plugins/endpoints/server";
import { originOf } from "@plugins/infra/plugins/request-origin/core";
import { isBrowserRequest } from "@plugins/framework/plugins/principal/core";
import { getTask } from "@plugins/tasks/plugins/tasks-core/server";
import {
  deleteTaskManageGrant,
  putTaskManageGrant,
} from "@plugins/tasks/plugins/task-mandate/plugins/manage-grant/core";
import {
  clearTaskManageGrant,
  GrantRefused,
  setTaskManageGrant,
} from "@plugins/tasks/plugins/task-mandate/plugins/manage-grant/server";
import { describeOwner, taskOwnership } from "./task-ownership";

/**
 * Only a person switches the grant, from the task header: a request no
 * browser sent (an agent's `curl`, a script, an MCP-side call — a local tool
 * reads as the owner at the gateway) or one an automated session marked (the
 * agent browser, an e2e run) is refused, on every backend. Best-effort, not a
 * security boundary: a client forging a browser's headers is not stopped
 * here (the guard refuses an agent's shell command naming the route).
 */
function assertPerson(req: Request): string {
  if (!isBrowserRequest(req))
    throw new HttpError(
      403,
      "Only a person can switch this grant, from the task's header — not a script or an agent.",
    );
  if (originOf(req).kind === "agent")
    throw new HttpError(
      403,
      "Only a person can switch this grant — an automated browser session cannot.",
    );
  return "switched by a person in the task header";
}

export const handlePutManageGrant = implement(
  putTaskManageGrant,
  async ({ params, req }) => {
    const how = assertPerson(req);
    if ((await getTask(params.taskId)) === null)
      throw new HttpError(404, `No task "${params.taskId}".`);
    // An agent that owns this task (a supervisor of its tree, a role, its
    // filer) could write the prompt its next run starts with — and that run
    // would hold the grant. Only a task no agent owns can hold it.
    const owner = await taskOwnership(params.taskId);
    if (owner !== null && owner.kind !== "person")
      throw new HttpError(
        409,
        `Task "${params.taskId}" is ${describeOwner(owner)}: an agent that owns a task could steer what its agent does, so only a task a person or the system filed can hold this grant.`,
      );
    try {
      await setTaskManageGrant(params.taskId, how);
    } catch (err) {
      if (err instanceof GrantRefused) throw new HttpError(409, err.message);
      throw err;
    }
  },
);

export const handleDeleteManageGrant = implement(
  deleteTaskManageGrant,
  async ({ params, req }) => {
    const how = assertPerson(req);
    await clearTaskManageGrant(params.taskId, how);
  },
);
