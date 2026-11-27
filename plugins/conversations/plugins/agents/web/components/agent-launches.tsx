import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { useLive } from "@plugins/network/plugins/live/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { useOpenPane } from "@plugins/primitives/plugins/pane/web";
import { stateIcons } from "@plugins/ui/plugins/icons/core";
import { conversationPane } from "@plugins/conversations/plugins/conversation-view/web";
import {
  DataView,
  defineDataView,
} from "@plugins/primitives/plugins/data-view/web";
import type {
  FieldDef,
  FieldOption,
} from "@plugins/primitives/plugins/data-view/core";
import {
  SectionLabel,
  Text,
} from "@plugins/primitives/plugins/css/plugins/text/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { agentLaunchRows, type AgentLaunchWithStatus } from "../../core";
import { useMemo } from "react";
import { useDateFormatter } from "@plugins/fields/plugins/date/plugins/format/web";
import type { DateFormatter } from "@plugins/fields/plugins/date/plugins/format/core";

const AGENT_LAUNCHES_VIEW = defineDataView("agent-launches");

function formatDate(fmt: DateFormatter, value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return fmt.dateTime(d, { year: "never" });
}

// Conversation statuses, in lifecycle order — drives the enum field's chip
// label + the filter/group-by option list. Mirrors ConversationStatusSchema.
const STATUS_OPTIONS: FieldOption[] = [
  {
    value: "starting",
    label: "Starting",
    variant: "info",
    icon: stateIcons.working,
  },
  {
    value: "working",
    label: "Working",
    variant: "info",
    icon: stateIcons.working,
  },
  {
    value: "waiting",
    label: "Waiting",
    variant: "warning",
    icon: stateIcons.needsYou,
  },
  { value: "gone", label: "Gone", variant: "muted", icon: stateIcons.canceled },
  {
    value: "done",
    label: "Done",
    variant: "success",
    icon: stateIcons.done,
  },
];

function launchTitle(
  fmt: DateFormatter,
  launch: AgentLaunchWithStatus,
): string {
  return (
    launch.latestConversation?.title ??
    `Launch ${formatDate(fmt, launch.createdAt)}`
  );
}

// The fields the list computes itself: the title and status come from the
// launch's joined latest conversation, not from a column. (The `agent-launches`
// collection lists no field of its own.)
const extraFields = (fmt: DateFormatter): FieldDef<AgentLaunchWithStatus>[] => [
  {
    id: "title",
    label: "Conversation",
    primary: true,
    value: (l) => launchTitle(fmt, l),
  },
  {
    id: "status",
    label: "Status",
    type: "enum",
    options: STATUS_OPTIONS,
    value: (l) => l.latestConversation?.status ?? null,
  },
  {
    id: "started",
    label: "Started",
    type: "date",
    value: (l) => l.createdAt,
  },
];

export function AgentLaunches({ agentId }: { agentId: string }) {
  const launchesQ = useLive(agentLaunchRows);
  const openPane = useOpenPane();
  const convEntry = conversationPane.useOpenedHere();
  const activeConvId = convEntry?.params.convId;
  const fmt = useDateFormatter();
  const fields = useMemo(() => extraFields(fmt), [fmt]);

  if (launchesQ.status === "loading") return <Loading variant="text" />;
  if (launchesQ.status === "error")
    return (
      <ResourceErrorInline
        variant="inline"
        subject="the attempts"
        error={launchesQ.error}
        refetch={launchesQ.refetch}
      />
    );

  const launches = launchesQ.data.filter((l) => l.agentId === agentId);

  // Highlight the row whose conversation is the one open in the pane.
  const selectedRowId = launches.find(
    (l) => l.latestConversation?.id === activeConvId,
  )?.id;

  return (
    <Stack as="section" gap="sm">
      <SectionLabel as="h3" className="font-medium">
        Attempts
      </SectionLabel>
      <DataView<AgentLaunchWithStatus>
        rows={launches}
        collection={agentLaunchRows}
        extraFields={fields}
        rowKey={(l) => l.id}
        views={["list"]}
        storageKey={AGENT_LAUNCHES_VIEW}
        selectedRowId={selectedRowId}
        emptyState={<Text tone="muted">No attempts yet.</Text>}
        onRowActivate={(l) => {
          const primary = l.latestConversation;
          if (!primary) return;
          if (activeConvId === primary.id && convEntry) {
            conversationPane.close(convEntry.instanceId);
          } else {
            openPane(
              conversationPane,
              { convId: primary.id },
              { mode: "push" },
            );
          }
        }}
      />
    </Stack>
  );
}
