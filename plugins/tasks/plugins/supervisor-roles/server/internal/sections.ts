import { SystemPrompt } from "@plugins/conversations/plugins/system-prompt/server";
import { getConfig } from "@plugins/config_v2/server";
import {
  conversationMandate,
  grantOf,
} from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { tasksFile } from "@plugins/tasks/plugins/tasks-core/core";
import { decisionsOpen } from "@plugins/tasks/plugins/decisions/plugins/capability/core";
import { mandateIsKindOf } from "@plugins/tasks/plugins/orchestration/plugins/mandate/plugins/definitions/server";
import { supervisorMandate } from "@plugins/tasks/plugins/mandate-presets/core";
import {
  supervisorPromptConfig,
  supervisorRoleMandate,
  type SupervisorRole,
} from "../../core";
import type { PromptText } from "@plugins/config_v2/plugins/prompts/core";
import {
  SUPERVISOR_HEADING,
  SUPERVISOR_ROLES_HEADING,
  supervisorBody,
  supervisorRolesBody,
} from "./prompt-bodies";
import {
  getSupervisorRole,
  listSupervisorRoles,
  supervisorOfTask,
} from "./roles";

/**
 * The listed roles, for an agent whose mandate lets it file into a backlog
 * (`tasks.file` with `backlog`). Nothing when no role is listed.
 */
export async function renderSupervisorRoles(
  conversationId: string,
): Promise<PromptText | null> {
  const grant = await grantOf(tasksFile, conversationId);
  if (grant?.backlog !== true) return null;
  const roles = await listSupervisorRoles();
  return supervisorRolesBody(
    getConfig(supervisorPromptConfig),
    roles.filter((r) => r.listed),
  );
}

/**
 * The Supervisor section, for the conversation at the ROOT of a supervisor
 * mandate (an ad-hoc supervisor, or a role's session) — never a worker below
 * it (see {@link supervisorBody}).
 */
export async function renderSupervisorPrompt(
  conversationId: string,
): Promise<PromptText | null> {
  const mandate = await conversationMandate(conversationId);
  if (mandate.kind === "none" || mandate.at !== "root") return null;
  if (!mandateIsKindOf(mandate.mandateId, supervisorMandate)) return null;
  let role: SupervisorRole | null = null;
  if (mandate.mandateId === supervisorRoleMandate.id) {
    const roleId = await supervisorOfTask(mandate.rootTaskId);
    role = roleId === null ? null : await getSupervisorRole(roleId);
    if (role === null)
      throw new Error(
        `Task ${mandate.rootTaskId} states the supervisor-role mandate but owns no existing supervisor role.`,
      );
  }
  const decisions = (await grantOf(decisionsOpen, conversationId)) === true;
  return supervisorBody(getConfig(supervisorPromptConfig), {
    role,
    decisionsTaskId: decisions ? mandate.rootTaskId : null,
  });
}

/** The Supervisor roles section's id — what the listing notice re-sends. */
export const SUPERVISOR_ROLES_SECTION_ID = "supervisor-roles";

export const supervisorRolesSection = SystemPrompt.Section({
  id: SUPERVISOR_ROLES_SECTION_ID,
  label: "Supervisor roles",
  heading: SUPERVISOR_ROLES_HEADING,
  followsMandate: true,
  render: renderSupervisorRoles,
});

export const supervisorPromptSection = SystemPrompt.Section({
  id: "supervisor-prompt",
  label: "Supervisor prompt",
  heading: SUPERVISOR_HEADING,
  followsMandate: true,
  render: renderSupervisorPrompt,
});
