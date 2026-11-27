import { useMemo, type ReactNode } from "react";
import {
  DataView,
  defineDataView,
  fieldOverrides,
  liveDataSource,
  type FieldDef,
} from "@plugins/primitives/plugins/data-view/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { InlineText } from "@plugins/primitives/plugins/inline-text/web";
import { RelativeTime } from "@plugins/primitives/plugins/relative-time/web";
import { proposalsList, type ProposalRow } from "../../core";
import { ANSWERABLE_STATES } from "../internal/answerable";

// Marker scraped by codegen (data-views.generated.ts). Must live in web/**.
const PROPOSALS_VIEW = defineDataView("tasks.proposals.list");

const source = liveDataSource(proposalsList, {
  surface: PROPOSALS_VIEW,
  searchable: ["note"],
  unscoped: {
    reason:
      "one record type's scope is stated by the view that owns those records, never a filter the user widens; proposals carry no custom columns",
  },
});

const overrides = fieldOverrides(proposalsList, {
  state: { width: "9rem" },
  note: {
    width: "minmax(0,1fr)",
    cell: (r) => <Text>{r.note.split(/\r?\n/, 1)[0]}</Text>,
  },
  authorTaskId: {
    width: "minmax(0,14rem)",
    cell: (r) => <InlineText text={r.authorTaskId} />,
  },
  createdAt: {
    width: "6rem",
    cell: (r) => (
      <Text tone="muted">
        <RelativeTime date={r.createdAt} />
      </Text>
    ),
  },
  revision: { visible: false },
  isNew: { width: "6rem" },
  type: { visible: false, filterable: false, groupable: false },
  scope: { visible: false, filterable: false, groupable: false },
  recordId: { visible: false, filterable: false, groupable: false },
  editedOnMainSinceFork: { visible: false },
  decidedAt: { visible: false },
});

/**
 * The proposals the user may still answer for one record type's scope — the
 * owner view's Proposed tab. A proposed new record is its own row. The owner
 * adds its own columns over the proposed values (`extraFields`: a tip's title,
 * its media) and opens a row where it draws its records.
 */
export function ProposalsDataView({
  type,
  scope,
  extraFields,
  selectedId,
  onOpen,
}: {
  type: string;
  scope: string;
  extraFields?: readonly FieldDef<ProposalRow>[];
  selectedId?: string;
  onOpen: (proposal: ProposalRow) => void;
}): ReactNode {
  const scoped = useMemo(
    () =>
      source.scoped({
        where: { type, scope, state: { in: [...ANSWERABLE_STATES] } },
      }),
    [type, scope],
  );
  return (
    <DataView<ProposalRow>
      source={scoped}
      overrides={overrides}
      extraFields={extraFields ? [...extraFields] : undefined}
      views={["table", "list"]}
      defaultView="table"
      selectedRowId={selectedId}
      onRowActivate={onOpen}
      emptyState={
        <>
          No proposals. An agent proposes a change from its worktree with
          ./equin propose.
        </>
      }
    />
  );
}
