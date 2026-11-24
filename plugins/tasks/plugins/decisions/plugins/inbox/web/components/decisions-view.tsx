import type { ReactElement } from "react";
import {
  DataViewSwitcher,
  defineDataView,
  fieldOverrides,
  liveDataSource,
  type DataViewSourceProps,
  type FieldDef,
} from "@plugins/primitives/plugins/data-view/web";
import {
  decisionsList,
  type DecisionRow,
  type DecisionTab,
} from "@plugins/tasks/plugins/decisions/core";
import {
  decisionPresentation,
  NewMark,
} from "@plugins/tasks/plugins/decisions/web";
import { DecisionsSources, type DecisionsHostProps } from "../slots";

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
  return (
    <DataViewSwitcher
      storageKey={DECISIONS_VIEW}
      sources={DecisionsSources}
      hostProps={hostProps}
      defaultView="needs"
    />
  );
}

function sourceComponent(tab: DecisionTab) {
  return function DecisionsSource({
    hostProps,
    render,
  }: DataViewSourceProps<DecisionsHostProps>) {
    return render<DecisionRow>({
      source: SCOPES[tab],
      overrides,
      extraFields,
      recipe: "inbox",
      place: PLACE,
      selectedRowId: hostProps.selectedId,
      rowActivation: (r) => hostProps.linkTo(r.id),
      emptyState: <>{EMPTY[tab]}</>,
    });
  };
}

export const NeedsSource = sourceComponent("needs");
export const SentSource = sourceComponent("sent");
export const FyiSource = sourceComponent("fyi");
export const ClosedSource = sourceComponent("closed");

/** Where each field sits on a row: the state dot leads, the question is the title, the new mark after it. */
const PLACE = {
  pill: "lead",
  isNew: "afterTitle",
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
  tab: { visible: false },
  state: { visible: false },
  taskId: { visible: false },
  fromDecisionId: { visible: false },
  updatedAt: { visible: false },
  closedAt: { visible: false },
  pendingQuestions: { visible: false },
  unconsumedAnswers: { visible: false },
  isNew: { cell: (r) => (r.isNew ? <NewMark /> : null) },
});

type Pill = "decision" | "action" | "fyi" | "other" | "sent" | "closed";

// The server's derived tab says Sent; an `other` decision sits there too but keeps its own state.
const pillOf = (r: DecisionRow): Pill =>
  r.tab === "sent" && r.state !== "other" ? "sent" : r.state;

// The state pill as the row's leading dot — computed from the state and the
// thread (an answer not acted on reads Sent), so it is drawn only.
const extraFields: FieldDef<DecisionRow>[] = [
  {
    id: "pill",
    label: "State",
    type: "enum",
    value: pillOf,
    options: (
      [
        ["decision", "decision"],
        ["action", "action"],
        ["fyi", "fyi"],
        ["other", "other"],
        ["sent", "decision"],
        ["closed", "closed"],
      ] as const
    ).map(([value, state]) => {
      const p = decisionPresentation({
        state,
        stateLabel: value === "other" ? "Other" : null,
        unconsumedAnswers: value === "sent" ? 1 : 0,
      });
      return { value, label: p.label, variant: p.variant };
    }),
    sortable: false,
    filterable: false,
    groupable: false,
  },
];
