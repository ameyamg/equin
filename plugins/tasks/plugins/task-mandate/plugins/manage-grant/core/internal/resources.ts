import type { z } from "zod";
import { liveCollection } from "@plugins/network/plugins/live/core";
import { dateField } from "@plugins/fields/plugins/date/plugins/config/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { nullable, type FieldsRecord } from "@plugins/fields/core";
import { defineIdKind, idKindField, type IdOf } from "@plugins/ids/core";
import { entityRef } from "@plugins/infra/plugins/entities/core";
import { defineExtensionShape } from "@plugins/infra/plugins/entity-extensions/core";

/**
 * The grant on one task, in `tasks_ext_manage_grant` (1:1 with its task):
 * a row = on. Written only by a person (the task header's switch, through
 * `putTaskManageGrant`), removed by the switch, and by the task settling
 * (done or dropped).
 */
export const taskManageGrantShape = defineExtensionShape({
  key: "taskId",
  fields: {
    grantedAt: dateField({ label: "Granted" }),
  },
});
export const TaskManageGrantRowSchema = taskManageGrantShape.schema;
export type TaskManageGrantRow = z.infer<typeof TaskManageGrantRowSchema>;

/** One task's grant: `useLive(taskManageGrants, { id: taskId })` —
 * `found: false` ⇒ off. Lookup-only: every reader asks about one task. */
export const taskManageGrants = liveCollection("tasks.manage-grant", {
  from: taskManageGrantShape,
  id: "taskId",
});

/** One recorded action taken under a grant (`task_unowned_actions.id`). */
export const unownedActionIdKind = defineIdKind({
  prefix: "grantact",
  label: "Action under a grant",
  shape: "uuid",
});
export type UnownedActionId = IdOf<typeof unownedActionIdKind>;

/**
 * The audit of a grant, on the task it concerns. Append-only, two kinds of
 * row:
 *
 * - an action an agent took on a task it does not own, allowed only by a
 *   person's grant on ITS task: `taskId` is the task acted on, `grantTaskId`
 *   the task whose grant allowed it (the authorisation), `conversationId` the
 *   agent that did it, `owner` who owned the task, in words ("filed by a
 *   person");
 * - the grant itself switched on or off (`taskId` = `grantTaskId`, no
 *   conversation or owner), `detail` saying how the request came.
 *
 * Soft references (no FK): the record outlives a deleted conversation.
 */
export const unownedActionFields = {
  id: idKindField(unownedActionIdKind),
  taskId: textField({ label: "Task" }),
  action: textField({ label: "Action", primary: true }),
  grantTaskId: textField({ label: "Granted on" }),
  conversationId: nullable(textField({ label: "Conversation" })),
  owner: nullable(textField({ label: "Owner" })),
  detail: nullable(textField({ label: "Detail" })),
  createdAt: dateField({ label: "When" }),
} satisfies FieldsRecord;

export const unownedActionsEntityRef = entityRef(
  "task_unowned_actions",
  unownedActionFields,
);

/**
 * The actions taken on a task under someone else's grant, newest first:
 * `useLive(unownedActions, { where: { taskId } })`.
 */
export const unownedActions = liveCollection("tasks.unowned-actions", {
  from: unownedActionsEntityRef,
  pick: ["taskId", "action", "grantTaskId", "conversationId", "createdAt"],
  carry: { pick: ["id", "owner", "detail"] },
  id: "id",
  sortable: ["createdAt"],
  default: { orderBy: [["createdAt", "desc"]], limit: 50 },
  maxLimit: 500,
});
export type UnownedAction = z.output<(typeof unownedActions)["row"]>;
