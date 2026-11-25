import { useMemo, type ReactElement } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import { foldResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  DataViewSwitcher,
  defineDataView,
  fieldOverrides,
  liveDataSource,
  type DataViewSourceProps,
} from "@plugins/primitives/plugins/data-view/web";
import type { DataViewSection } from "@plugins/primitives/plugins/data-view/core";
import {
  decisionsList,
  type DecisionRow,
  type DecisionTab,
} from "@plugins/tasks/plugins/decisions/core";
import {
  decisionDraftField,
  decisionPillField,
  NewMark,
  useDecisionDrafts,
} from "@plugins/tasks/plugins/decisions/web";
import { DecisionsSources, type DecisionsHostProps } from "../slots";
import { AgentConversationAction } from "./agent-link";

// Marker scraped by codegen (data-views.generated.ts). Must live in web/**.
// Its views are authored in `config/tasks/decisions/inbox/tasks.decisions.jsonc`.
const DECISIONS_VIEW = defineDataView("tasks.decisions");

// Every decision, as live key-range pages of `decisions.list`; each tab is the
// window scoped server-side by the derived `tab`, so its groups and search
// are the tab's own. A reply, a consumed answer or a close moves a row
// between tabs live.
const decisionsSource = liveDataSource(decisionsList, {
  surface: DECISIONS_VIEW,
  searchable: ["question", "label"],
  unscoped: {
    reason:
      "a user's inbox of at most a few hundred open questions, read by tab and grouped by agent: a custom column would sort and filter nothing the derived fields do not",
  },
});

type DecisionsScope = ReturnType<typeof decisionsSource.scoped>;

const SCOPES = {
  needs: decisionsSource.scoped({ where: { tab: "needs" } }),
  sent: decisionsSource.scoped({ where: { tab: "sent" } }),
  fyi: decisionsSource.scoped({ where: { tab: "fyi" } }),
  closed: decisionsSource.scoped({ where: { tab: "closed" } }),
} satisfies Record<DecisionTab, DecisionsScope>;

const EMPTY: Record<DecisionTab, string> = {
  needs: "Nothing needs you.",
  sent: "Nothing sent: no answer is waiting on its agent.",
  fyi: "Nothing to know about.",
  closed: "No decision closed yet.",
};

/**
 * The Decisions inbox: every decision an agent opened, one view bar over the
 * four tabs, each grouped by the agent waiting on it (the authored views).
 */
export function DecisionsView(hostProps: DecisionsHostProps): ReactElement {
  // Every tab's count, one grouping of the derived tab (as the sidebar's).
  const groups = useLive(decisionsList, { groupBy: "tab" });
  // Each tab's count once known; none while loading or failed (the sidebar
  // entry says a failed read).
  const counts = foldResource(groups, {
    loading: () => null,
    error: () => null,
    ready: (data) => new Map(data.map((g) => [g.value as string, g.count])),
  });
  const sourceCounts = (sourceId: string): number | undefined =>
    counts === null ? undefined : (counts.get(sourceId) ?? 0);
  return (
    <DataViewSwitcher
      storageKey={DECISIONS_VIEW}
      sources={DecisionsSources}
      hostProps={hostProps}
      defaultView="needs"
      sourceCounts={sourceCounts}
    />
  );
}

function sourceComponent(tab: DecisionTab) {
  return function DecisionsSource({
    hostProps,
    render,
  }: DataViewSourceProps<DecisionsHostProps>) {
    const { drafts } = useDecisionDrafts();
    const fields = useMemo(
      () => [decisionPillField, decisionDraftField(drafts)],
      [drafts],
    );
    return render<DecisionRow>({
      source: SCOPES[tab],
      overrides,
      extraFields: fields,
      recipe: "inbox",
      place: PLACE,
      selectedRowId: hostProps.selectedId,
      rowActivation: (r) => hostProps.linkTo(r.id),
      // j / k read the next / previous decision, as the rows are drawn.
      viewOptions: STEP_KEYS,
      headerActions: agentHeaderAction,
      emptyState: <>{EMPTY[tab]}</>,
    });
  };
}

const STEP_KEYS = { list: { stepKeys: true } } as const;

/**
 * A group header's Open conversation, when its rows all belong to one agent
 * (the authored grouping, by `taskId`; a regrouping that mixes agents gets
 * none). The section's rows are this source's: `DecisionRow`s, typed
 * `unknown` by the DataView's section-wide callback.
 */
function agentHeaderAction(
  section: DataViewSection<unknown>,
): ReactElement | null {
  const rows = section.entries.map((e) => e.row as DecisionRow);
  const first = rows[0];
  if (first === undefined || rows.some((r) => r.taskId !== first.taskId))
    return null;
  return (
    <AgentConversationAction taskId={first.taskId} title={first.taskTitle} />
  );
}

export const NeedsSource = sourceComponent("needs");
export const SentSource = sourceComponent("sent");
export const FyiSource = sourceComponent("fyi");
export const ClosedSource = sourceComponent("closed");

/** Where each field sits on a row: the state dot leads, the question is the title, the new mark after it. */
const PLACE = {
  pill: "lead",
  isNew: "afterTitle",
  draft: "line2",
  label: "line2",
  outcome: "line2",
  openedAt: "edge",
} as const;

// How the collection's fields present here. `taskTitle` is the grouping (the
// agent waiting on the decision), never a printed column; the tab is the
// source's scope.
const overrides = fieldOverrides(decisionsList, {
  question: { primary: true },
  taskTitle: { visible: false },
  // The grouping: the agent waiting on it, by its task (two agents sharing a
  // title are two groups), labelled by the task's title.
  taskId: { visible: false },
  tab: { visible: false },
  state: { visible: false },
  fromDecisionId: { visible: false },
  updatedAt: { visible: false },
  closedAt: { visible: false },
  pendingQuestions: { visible: false },
  unconsumedAnswers: { visible: false },
  isNew: { cell: (r) => (r.isNew ? <NewMark /> : null) },
});
