import type { ReactElement } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { outcomeReportRows } from "../../core";
import { OutcomeReportView } from "./outcome-report-view";

/**
 * One task's outcome report, read-only — for surfaces listing automated tasks
 * (the automation's History rows), with its loading and "no report yet" states.
 */
export function OutcomeReportDetail({
  taskId,
}: {
  taskId: string;
}): ReactElement {
  const result = useLive(outcomeReportRows, { id: taskId });
  if (result.status === "loading") return <Loading />;
  if (result.status === "error")
    return (
      <ResourceErrorInline
        variant="inline"
        subject="the outcome report"
        error={result.error}
        refetch={result.refetch}
      />
    );
  if (!result.found)
    return (
      <Text variant="caption" tone="muted">
        No outcome report yet.
      </Text>
    );
  return <OutcomeReportView report={result.row} />;
}
