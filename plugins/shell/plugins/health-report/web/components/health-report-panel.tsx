import {
  renderAsContribution,
  useSlotOrder,
  useSlotPlacement,
  type SlotPlaced,
} from "@plugins/primitives/plugins/slot-render/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { ControlSizeProvider } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import type { SealContributions } from "@plugins/framework/plugins/web-sdk/core";
import {
  mergeDot,
  placeRows,
  verdictOf,
  type HealthReportRow,
  type ReportedStatus,
} from "../../core";
import { HealthReport } from "../slots";
import {
  HealthStore,
  reportedStatusesOf,
  setItemId,
  type HealthReportState,
} from "../internal/store";
import { HealthDot } from "./health-dot";
import {
  InfoRowView,
  MoreRowsView,
  StatusRowView,
  type StatusLine,
} from "./health-row";

type SealedRow = SealContributions<HealthReportRow>;
type SealedInfoRow = Extract<SealedRow, { kind: "info" }>;

/**
 * One line of the report, as `placeRows` arranges it: an info row, or a status
 * line — a row set already expanded into its items, so each item is placed as
 * an ordinary row.
 */
type ReportLine =
  | { kind: "info"; id: string; row: SealedInfoRow }
  | { kind: "status"; id: string; line: StatusLine };

function statusLine(line: StatusLine): ReportLine {
  return { kind: "status", id: line.id, line };
}

/** One row's lines: itself, or a row set's items (its placeholder while it has none). */
function lineOf(row: SealedRow, state: HealthReportState): ReportLine[] {
  switch (row.kind) {
    case "info":
      return [{ kind: "info", id: row.id, row }];
    case "status":
      return [statusLine({ kind: "status", id: row.id, row })];
    case "set": {
      const items = state.sets[row.id];
      if (items === undefined)
        return [statusLine({ kind: "set-placeholder", id: row.id, row })];
      return items.map((item) =>
        statusLine({
          kind: "set-item",
          id: setItemId(row.id, item.key),
          row,
          rowKey: item.key,
          title: item.title,
        }),
      );
    }
  }
}

/**
 * One row, drawn by the report but rendered AS its contribution: inside the
 * slot's item middlewares and box (`renderAsContribution`) — so a crashing
 * contributor leaves the rest readable, and an element pick on the row names
 * the plugin that contributed it rather than the report.
 */
function ContributedRow({
  line,
  statuses,
}: {
  line: ReportLine;
  statuses: Readonly<Record<string, ReportedStatus>>;
}) {
  return line.kind === "status"
    ? renderAsContribution(
        HealthReport.Row,
        line.line.row,
        <StatusRowView line={line.line} status={statuses[line.id]} />,
      )
    : renderAsContribution(
        HealthReport.Row,
        line.row,
        <InfoRowView row={line.row} useInfo={line.row.useInfo} />,
      );
}

/**
 * The report: a header with the merged dot and the verdict, then the rows as a
 * plain list in the slot's layout order, never by status — and the rows the
 * layout puts in its overflow behind a "v" at the end, except one that stands
 * out (needs a look, worth knowing), which joins the list (`placeRows`).
 * No footer:
 * a row that has a pane to point at does so through its own `actions`, so the
 * report never names a contributor.
 *
 * Mounted only while the popover is open, which is what keeps an info row's
 * `useInfo` from running while nobody is looking.
 *
 * While the rows' layout order is not known yet the whole report — verdict
 * included, since it derives from the rows — is a loading state, never the
 * rows in raw registration order (which would show hidden rows and then jump).
 */
/**
 * The report's header strip — the merged dot and the verdict — drawn in the
 * popover's own `header` slot (sticky, its rule across the panel, its text on
 * the panel's text rail). Always drawn (the slot's strip is there either way):
 * over the ordered rows once their order is known, else over every status the
 * probes have published — the same set, since one probe is mounted per
 * contributed row, which is what the button's dot merges too.
 */
export function HealthReportHeader() {
  const order = useSlotOrder(HealthReport.Row);
  const state = HealthStore.useStore();
  const rows =
    order.status === "ready"
      ? order.data
      : order.status === "error"
        ? order.stale
        : undefined;
  const statusList =
    rows === undefined
      ? Object.values(state.statuses)
      : rows.flatMap((row) =>
          row.kind === "info" ? [] : reportedStatusesOf(state, row),
        );
  // The same dot as the action bar's: an ambient row (the machine busy) is
  // shown as it is in its own row and named by the verdict, but never
  // colours the dot — here or in the bar.
  const merged = mergeDot(statusList);
  const verdict = verdictOf(statusList);
  return (
    <Line className="gap-sm">
      <ControlSizeProvider size="lg">
        <HealthDot
          level={merged.state}
          pulsing={merged.pending || merged.transitioning}
        />
      </ControlSizeProvider>
      <Fill>
        <Text variant="label" className="font-semibold" title={verdict}>
          {verdict}
        </Text>
      </Fill>
    </Line>
  );
}

export function HealthReportPanel() {
  const placement = useSlotPlacement(HealthReport.Row);
  switch (placement.status) {
    case "loading":
      return <Loading variant="rows" count={4} />;
    case "error":
      return placement.stale === undefined ? (
        <ResourceErrorInline
          error={placement.error}
          refetch={placement.refetch}
          variant="block"
          subject="the health report"
        />
      ) : (
        <HealthReportPanelReady placed={placement.stale} />
      );
    case "ready":
      return <HealthReportPanelReady placed={placement.data} />;
  }
}

/** The report once its rows' placement is known — see {@link HealthReportPanel}. */
function HealthReportPanelReady({
  placed,
}: {
  placed: readonly SlotPlaced<SealedRow>[];
}) {
  const state = HealthStore.useStore();
  const { statuses } = state;
  const statusOf = (line: ReportLine) =>
    line.kind === "status" ? statuses[line.id] : undefined;
  // An `absent` row has nothing to say here: it is not drawn at all.
  const lines = placed.flatMap(({ contribution, overflow }) =>
    lineOf(contribution, state)
      .filter((line) => statusOf(line)?.state !== "absent")
      .map((line) => ({ row: line, overflow })),
  );
  const { shown, tucked } = placeRows(lines, statusOf);

  return (
    <>
      {shown.length + tucked.length > 0 ? (
        <Stack gap="2xs">
          {/* Not a DataView: these are slot contributions — a handful at
              most — in the slot's layout order, inside a transient popover. */}
          {shown.map((line) => (
            <ContributedRow key={line.id} line={line} statuses={statuses} />
          ))}
          {tucked.length > 0 ? (
            <MoreRowsView count={tucked.length}>
              {tucked.map((line) => (
                <ContributedRow key={line.id} line={line} statuses={statuses} />
              ))}
            </MoreRowsView>
          ) : null}
        </Stack>
      ) : null}
    </>
  );
}
