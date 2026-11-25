import type { ReactElement } from "react";
import { Markdown } from "@plugins/primitives/plugins/markdown/web";
import { Expandable } from "@plugins/primitives/plugins/expandable/web";
import {
  Badge,
  type BadgeVariant,
} from "@plugins/primitives/plugins/css/plugins/badge/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { RelativeTime } from "@plugins/primitives/plugins/relative-time/web";
import type { OutcomeReport, ReportStanding } from "../../core";

const STANDING: Record<
  ReportStanding,
  { label: string; variant: BadgeVariant }
> = {
  landed: { label: "Pushed", variant: "success" },
  pending: { label: "Branch waiting for push", variant: "warning" },
  none: { label: "No changes", variant: "muted" },
};

/**
 * One outcome report: its standing when the run was handed back, and the
 * markdown body — the agent's last message of that run (clamped, Show more
 * past 12rem).
 */
export function OutcomeReportView({
  report,
}: {
  report: OutcomeReport;
}): ReactElement {
  const standing = STANDING[report.standing];
  return (
    <Stack gap="sm">
      <Stack direction="row" gap="sm" align="center">
        <Text variant="label">Outcome report</Text>
        <Badge variant={standing.variant}>{standing.label}</Badge>
        <Text variant="caption" tone="muted">
          <RelativeTime date={new Date(report.submittedAt)} />
        </Text>
      </Stack>
      <Expandable>
        <Markdown>{report.body}</Markdown>
      </Expandable>
    </Stack>
  );
}
