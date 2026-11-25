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
import { supervisorRoleMandate } from "../../core";
import { supervisorPromptConfig } from "../../core";
import {
  getSupervisorRole,
  listSupervisorRoles,
  supervisorOfTask,
} from "./roles";

/**
 * The listed roles, for an agent whose mandate lets it file into a backlog
 * (`tasks.file` with `backlog`): one item each — name, id, description (its
 * further lines indented under the item) — and how to file. Nothing when no
 * role is listed.
 */
export async function renderSupervisorRoles(
  conversationId: string,
): Promise<string | null> {
  const grant = await grantOf(tasksFile, conversationId);
  if (grant?.backlog !== true) return null;
  const roles = await listSupervisorRoles();
  const listed = roles.filter((r) => r.listed);
  if (listed.length === 0) return null;
  const lines = listed.map((r) => {
    // A multi-line description stays inside its list item.
    const description = r.description.trim().replace(/\n/g, "\n  ");
    return `- **${r.name}** (\`${r.id}\`)${description ? ` — ${description}` : ""}`;
  });
  return [
    "## Supervisor roles",
    "",
    'Work that is not part of your own task — a problem you found, a follow-up some other area owns — can be handed to a supervisor role instead of filed under your task: `add_task` with `supervisor: "<role id>"` and `start: "manual"` files it into that role\'s backlog, where it waits until a session of the role adopts it.',
    "",
    "Roles:",
    ...lines,
  ].join("\n");
}

/**
 * How a supervisor root records what needs the user — code-owned, not part of
 * the shared prompt config: it names tools and a block tag, so it must follow
 * the code, and a user's own override of the shared prompt (written before
 * decisions existed) must not hide it. Only while `decisions.open` is granted.
 */
function decisionsGuidance(taskId: string): string {
  return [
    '**Decisions.** This replaces any page-based list of decisions ("Still open" / "Decided" sections, numbered "D<n>" items) your other instructions describe: everything that needs the user — a choice, an action only they can take, something they should know — is a decision you open with `open_decision`, its context in its `body`. Keep it current with `update_decision`, notes included after it closes.',
    `On your session page, place one \`<task-decisions task="${taskId}"/>\` block (with \`edit_page\`, near the top — in your agent page, or an \`<agent-inline>\` card on a page of the user's): it shows your task's decisions live and the user answers them there.`,
  ].join("\n\n");
}

/**
 * The shared supervisor prompt, for the conversation at the ROOT of a
 * supervisor mandate (an ad-hoc supervisor, or a role's session) — never a
 * worker below it. A role session also reads which role it works for, and a
 * root granted `decisions.open` how it records what needs the user. Nothing
 * when none has anything to say.
 */
export async function renderSupervisorPrompt(
  conversationId: string,
): Promise<string | null> {
  const mandate = await conversationMandate(conversationId);
  if (mandate.kind === "none" || mandate.at !== "root") return null;
  if (!mandateIsKindOf(mandate.mandateId, supervisorMandate)) return null;
  const isRole = mandate.mandateId === supervisorRoleMandate.id;
  const parts: string[] = [];
  if (isRole) {
    const roleId = await supervisorOfTask(mandate.rootTaskId);
    const role = roleId === null ? null : await getSupervisorRole(roleId);
    if (role === null)
      throw new Error(
        `Task ${mandate.rootTaskId} states the supervisor-role mandate but owns no existing supervisor role.`,
      );
    parts.push(
      `You are this session of the **${role.name}** supervisor role (\`${role.id}\`): work through its backlog (\`backlog\` lists it, \`adopt_task\` moves a task into your tree and arms it), route what belongs elsewhere (\`route_task\`), and manage every task the role owns — its backlog and its earlier sessions — with \`edit_task\` / \`drop_task\`. Your task's description is the role's brief.`,
    );
  }
  const shared = getConfig(supervisorPromptConfig).prompt.trim();
  if (shared) parts.push(shared);
  if ((await grantOf(decisionsOpen, conversationId)) === true)
    parts.push(decisionsGuidance(mandate.rootTaskId));
  if (parts.length === 0) return null;
  return ["## Supervisor", "", parts.join("\n\n")].join("\n");
}

/** The Supervisor roles section's id — what the listing notice re-sends. */
export const SUPERVISOR_ROLES_SECTION_ID = "supervisor-roles";

export const supervisorRolesSection = SystemPrompt.Section({
  id: SUPERVISOR_ROLES_SECTION_ID,
  label: "Supervisor roles",
  followsMandate: true,
  render: renderSupervisorRoles,
});

export const supervisorPromptSection = SystemPrompt.Section({
  id: "supervisor-prompt",
  label: "Supervisor prompt",
  followsMandate: true,
  render: renderSupervisorPrompt,
});
