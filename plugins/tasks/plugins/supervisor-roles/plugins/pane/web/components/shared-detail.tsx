import type { ReactElement } from "react";
import { useConfig, useSetConfig } from "@plugins/config_v2/web";
import { foldResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Card } from "@plugins/primitives/plugins/css/plugins/card/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { supervisorPromptConfig } from "@plugins/tasks/plugins/supervisor-roles/core";
import { unknownTemplateVariables } from "@plugins/packages/plugins/prompt-template/core";
import { useAdhocSupervisors, useRoles } from "../internal/reads";
import { InlineMarkdownField } from "./inline-fields";
import { SettingRow } from "./setting-row";
import { EventRoutingSection } from "./event-routing-section";

const sharedIcon = symbol("stacks");

/**
 * The pinned "All supervisors" entry: the prompts every supervisor session is
 * launched with — ad-hoc ones and every role's — ahead of the role's own: the
 * shared prompt, the decisions prompt (how it records what needs the user),
 * the role session prompt (what a role's session is told about its role), and
 * the roles listing prompt (how other agents hand work to a role). The same
 * values as Settings → Config → Supervisors.
 */
export function SharedDetail(): ReactElement {
  return (
    <Stack gap="xl" className="rail-lg">
      <Stack direction="row" gap="md" align="center">
        <Card padding="sm" className={rigidClass()}>
          <Icon icon={sharedIcon} className="size-5" />
        </Card>
        <Stack gap="none">
          <Text as="h2" variant="title">
            All supervisors
          </Text>
          <Counts />
        </Stack>
      </Stack>
      <Card padding="none">
        <PromptRow
          name="prompt"
          label="Shared prompt"
          namespace="supervisor-shared-prompt"
          placeholder="What every supervisor session is launched with"
          keepField="supervisor-roles.shared-prompt"
        />
        <PromptRow
          name="decisionsPrompt"
          label="Decisions prompt"
          namespace="supervisor-decisions-prompt"
          placeholder="How every supervisor records what needs you ({{taskId}}: its root task id)"
          keepField="supervisor-roles.decisions-prompt"
        />
        <PromptRow
          name="roleSessionPrompt"
          label="Role session prompt"
          namespace="supervisor-role-session-prompt"
          placeholder="What a role's session is told about its role ({{roleName}}, {{roleId}})"
          keepField="supervisor-roles.role-session-prompt"
        />
        <PromptRow
          name="rolesPrompt"
          label="Roles listing prompt"
          namespace="supervisor-roles-prompt"
          placeholder="How other agents hand work to a role ({{roles}}: the listed roles)"
          keepField="supervisor-roles.roles-prompt"
        />
      </Card>
      <EventRoutingSection />
    </Stack>
  );
}

type PromptName = keyof typeof supervisorPromptConfig.fields;

/**
 * One of the supervisors' prompts, edited inline. A template naming a
 * variable its field is not filled with is refused here, with the field's own
 * variable list — the config's schema refuses it at save as well, but this
 * says which ones are offered.
 */
function PromptRow({
  name,
  label,
  namespace,
  placeholder,
  keepField,
}: {
  name: PromptName;
  label: string;
  namespace: string;
  placeholder: string;
  keepField: string;
}): ReactElement {
  const config = useConfig(supervisorPromptConfig);
  const setConfig = useSetConfig(supervisorPromptConfig);
  const field = supervisorPromptConfig.fields[name];
  return (
    <SettingRow label={label} top>
      <InlineMarkdownField
        label={label}
        namespace={namespace}
        placeholder={placeholder}
        value={config[name]}
        keep={{ field: keepField, subject: "shared" }}
        onSave={(prompt) => {
          const unknown = unknownTemplateVariables(prompt, field.variables);
          if (unknown.length > 0) {
            const offered =
              field.variables.length === 0
                ? "No variable is filled"
                : `Only ${field.variables.map((v) => `{{${v.name}}}`).join(", ")} ${field.variables.length === 1 ? "is" : "are"} filled`;
            throw new Error(
              `${offered}; this prompt also uses ${unknown.map((n) => `{{${n}}}`).join(", ")}.`,
            );
          }
          if (!setConfig(name, prompt))
            throw new Error(`The ${label.toLowerCase()} was not saved.`);
        }}
      />
    </SettingRow>
  );
}

function Counts(): ReactElement | null {
  const roles = useRoles();
  const adhoc = useAdhocSupervisors();
  const n = foldResource(roles, {
    loading: () => null,
    error: () => null,
    ready: (r) => r.length,
  });
  const a = foldResource(adhoc, {
    loading: () => null,
    error: () => null,
    ready: (r) => r.length,
  });
  if (n === null || a === null) return null;
  return (
    <Text variant="caption" tone="muted">
      {`${n} supervisors · ${a} ad hoc`}
    </Text>
  );
}
