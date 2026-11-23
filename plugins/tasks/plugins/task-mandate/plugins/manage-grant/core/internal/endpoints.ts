import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";

/**
 * Turn the grant on for a task — a person, from the task header. Refused to
 * an agent-driven request on every backend (not only main), and on a task
 * that is done or dropped.
 */
export const putTaskManageGrant = defineEndpoint({
  route: "PUT /api/tasks/:taskId/manage-grant",
});

/** Turn the grant off — a person, from the task header (agents refused). */
export const deleteTaskManageGrant = defineEndpoint({
  route: "DELETE /api/tasks/:taskId/manage-grant",
});
