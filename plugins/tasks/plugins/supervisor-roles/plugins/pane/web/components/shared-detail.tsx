import type { ReactElement } from "react";
import { useConfig, useSetConfig } from "@plugins/config_v2/web";
import { foldResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Card } from "@plugins/primitives/plugins/css/plugins/card/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import {
  DECISIONS_PROMPT_VARIABLES,
  supervisorPromptConfig,
} from "@plugins/tasks/plugins/supervisor-roles/core";
import { unknownTemplateVariables } from "@plugins/packages/plugins/prompt-template/core";
import { useAdhocSupervisors, useRoles } from "../internal/reads";
import { InlineMarkdownField } from "./inline-fields";
import { SettingRow } from "./setting-row";
import { EventRoutingSection } from "./event-routing-section";

const sharedIcon = symbol("stacks");

/**
 * The pinned "All supervisors" entry: the prompts every supervisor session is
 * launched with — ad-hoc ones and every role's — ahead of the role's own: the
 * shared prompt, and the decisions prompt (how it records what needs the
 * user). The same values as Settings → Config → Supervisors.
 */
export function SharedDetail(): ReactElement {
  const config = useConfig(supervisorPromptConfig);
  const setConfig = useSetConfig(supervisorPromptConfig);
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
        <SettingRow label="Shared prompt" top>
          <InlineMarkdownField
            label="Shared prompt"
            namespace="supervisor-shared-prompt"
            placeholder="What every supervisor session is launched with"
            value={config.prompt}
            keep={{
              field: "supervisor-roles.shared-prompt",
              subject: "shared",
            }}
            onSave={(prompt) => {
              if (!setConfig("prompt", prompt))
                throw new Error("The shared prompt was not saved.");
            }}
          />
        </SettingRow>
        <SettingRow label="Decisions prompt" top>
          <InlineMarkdownField
            label="Decisions prompt"
            namespace="supervisor-decisions-prompt"
            placeholder="How every supervisor records what needs you ({{taskId}}: its root task id)"
            value={config.decisionsPrompt}
            keep={{
              field: "supervisor-roles.decisions-prompt",
              subject: "shared",
            }}
            onSave={(prompt) => {
              // Refused here, not at launch: an unknown variable would drop
              // the whole Supervisor section from every supervisor.
              const unknown = unknownTemplateVariables(
                prompt,
                DECISIONS_PROMPT_VARIABLES,
              );
              if (unknown.length > 0)
                throw new Error(
                  `Only {{taskId}} is filled; this prompt also uses ${unknown.map((n) => `{{${n}}}`).join(", ")}.`,
                );
              if (!setConfig("decisionsPrompt", prompt))
                throw new Error("The decisions prompt was not saved.");
            }}
          />
        </SettingRow>
      </Card>
      <EventRoutingSection />
    </Stack>
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
