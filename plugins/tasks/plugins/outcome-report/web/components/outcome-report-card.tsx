import type { ReactElement } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Card } from "@plugins/primitives/plugins/css/plugins/card/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import type { Conversation as ConversationRecord } from "@plugins/tasks/plugins/tasks-core/core";
import { outcomeReportRows } from "../../core";
import { OutcomeReportView } from "./outcome-report-view";

/**
 * The report at the end of the transcript of the conversation that handed it
 * back — scrolling with the transcript, never pinned over it. A question the
 * agent needs answered is its AskUserQuestion card, not part of the report.
 */
export function OutcomeReportCard({
  conversation,
}: {
  conversation: ConversationRecord;
}): ReactElement | null {
  const result = useLive(outcomeReportRows, { id: conversation.taskId });
  // Not loaded yet and "no report" both render nothing: an optional banner.
  if (result.status === "loading") return null;
  if (result.status === "error")
    return (
      <ResourceErrorInline
        variant="inline"
        subject="the outcome report"
        error={result.error}
        refetch={result.refetch}
      />
    );
  if (!result.found) return null;
  const report = result.row;
  // A task's report belongs to the conversation that handed it back; a
  // sibling conversation of the same task does not show it.
  if (report.conversationId !== conversation.id) return null;
  return (
    <Card>
      <OutcomeReportView report={report} />
    </Card>
  );
}

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
