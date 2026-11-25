import type { ConfigValues } from "@plugins/config_v2/core";
import {
  fillPrompt,
  joinPrompts,
  type PromptText,
} from "@plugins/config_v2/plugins/prompts/core";
import { supervisorPromptConfig, type SupervisorRole } from "../../core";

/** The Supervisor roles section's title (the composer writes `## …`). */
export const SUPERVISOR_ROLES_HEADING = "Supervisor roles";

/** The Supervisor prompt section's title (the composer writes `## …`). */
export const SUPERVISOR_HEADING = "Supervisor";

export type SupervisorPromptValues = ConfigValues<
  (typeof supervisorPromptConfig)["fields"]
>;

/** What the Supervisor roles section lists of a role. */
type ListedRole = Pick<SupervisorRole, "name" | "id" | "description">;

/**
 * The Supervisor roles section's body: the roles prompt filled with the
 * listed roles — one item each, name, id, description (its further lines
 * indented under the item). Nothing when no role is listed.
 */
export function supervisorRolesBody(
  values: SupervisorPromptValues,
  listed: readonly ListedRole[],
): PromptText | null {
  if (listed.length === 0) return null;
  const roles = listed
    .map((r) => {
      // A multi-line description stays inside its list item.
      const description = r.description.trim().replace(/\n/g, "\n  ");
      return `- **${r.name}** (\`${r.id}\`)${description ? ` — ${description}` : ""}`;
    })
    .join("\n");
  return fillPrompt(supervisorPromptConfig, values, "rolesPrompt", { roles });
}

/**
 * The Supervisor section's body, from what applies to the root: a role
 * session reads which role it works for (the role session prompt), then the
 * shared prompt, then — for a root granted `decisions.open` — the decisions
 * prompt filled with its root task id. The shared and decisions prompts are
 * read trimmed (a blank one adds nothing). Nothing when none says anything.
 */
export function supervisorBody(
  values: SupervisorPromptValues,
  opts: {
    role: Pick<SupervisorRole, "name" | "id"> | null;
    decisionsTaskId: string | null;
  },
): PromptText | null {
  const trimmed: SupervisorPromptValues = {
    ...values,
    prompt: values.prompt.trim(),
    decisionsPrompt: values.decisionsPrompt.trim(),
  };
  return joinPrompts([
    opts.role === null
      ? null
      : fillPrompt(supervisorPromptConfig, values, "roleSessionPrompt", {
          roleName: opts.role.name,
          roleId: opts.role.id,
        }),
    fillPrompt(supervisorPromptConfig, trimmed, "prompt", {}),
    opts.decisionsTaskId === null
      ? null
      : fillPrompt(supervisorPromptConfig, trimmed, "decisionsPrompt", {
          taskId: opts.decisionsTaskId,
        }),
  ]);
}
