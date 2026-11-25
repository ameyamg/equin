import { useMemo, useRef, useState, type ReactElement } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  DataView,
  defineDataView,
  fieldOverrides,
  liveDataSource,
} from "@plugins/primitives/plugins/data-view/web";
import type { HostedToolbarParts } from "@plugins/primitives/plugins/data-view/core";
import {
  CollapsibleChevron,
  FoldMotion,
  useCollapsible,
} from "@plugins/primitives/plugins/collapsible/web";
import { Clip } from "@plugins/primitives/plugins/css/plugins/clip/web";
import {
  Fill,
  fillClasses,
} from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Scroll } from "@plugins/primitives/plugins/css/plugins/scroll/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import {
  Text,
  useTextVariantClass,
} from "@plugins/primitives/plugins/css/plugins/text/web";
import { Button, cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { activationProps } from "@plugins/primitives/plugins/link-gesture/web";
import type { LinkTarget } from "@plugins/primitives/plugins/link-gesture/core";
import type { TaskId } from "@plugins/tasks/plugins/task-ids/core";
import { decisionsList, type DecisionRow } from "../../core";
import { useDecisionDrafts } from "../internal/drafts";
import { useMarkDecisionSeen } from "../internal/use-mark-seen";
import { decisionDraftField, decisionPillField } from "../internal/row-fields";
import { DecisionCard } from "./decision-card";
import { NewMark } from "./decision-state";
import { SubmitBar } from "./submit-bar";

// Markers scraped by codegen (data-views.generated.ts). Their views are
// authored in `config/tasks/decisions/tasks.decisions.panel-*.jsonc`.
const OPEN_VIEW = defineDataView("tasks.decisions.panel-open");
const CLOSED_VIEW = defineDataView("tasks.decisions.panel-closed");

const UNSCOPED = {
  reason:
    "one task's decisions (at most DECISIONS_PER_TASK_MAX), read in a panel above a composer or on a page: a custom column would sort and filter nothing here",
} as const;

const openSource = liveDataSource(decisionsList, {
  surface: OPEN_VIEW,
  searchable: ["question", "label"],
  unscoped: UNSCOPED,
});
const closedSource = liveDataSource(decisionsList, {
  surface: CLOSED_VIEW,
  searchable: ["question", "label", "outcome"],
  unscoped: UNSCOPED,
});

/** What a task's decisions count, per derived tab. */
interface Counts {
  needs: number;
  fyi: number;
  /** Not closed: Needs you, Sent and FYI. */
  open: number;
  closed: number;
}

/**
 * A task's decisions, as one panel — what the conversation tray (above the
 * composer) and the page block draw: a "N decisions need you" header that
 * folds the panel on click, with "Open in Decisions"; one row per open
 * decision (state dot, label, question, the drafted answer, the new mark),
 * each expanding inline into its {@link DecisionCard}, answered in place with
 * the same drafts as the inbox; a collapsed "N closed" row whose lines (label,
 * outcome) expand into the decision and its thread; and the SubmitBar scoped
 * to the task.
 *
 * `whenSettled`: `"hide"` draws nothing while no decision waits on the user
 * — none in Needs you or FYI (the tray: nothing to answer, nothing over the
 * composer; a Sent one waits on the agent); `"show"` draws
 * the panel whatever it holds (the page block).
 */
export function TaskDecisionsPanel({
  taskId,
  inboxLink,
  whenSettled,
}: {
  taskId: TaskId;
  /** Where "Open in Decisions" goes: the inbox. */
  inboxLink: LinkTarget;
  whenSettled: "hide" | "show";
}): ReactElement | null {
  // Every tab's count for this task, one grouping (the SubmitBar's own read).
  const groups = useLive(decisionsList, { groupBy: "tab", where: { taskId } });
  // The panel: where its Submit's ⌘↵ belongs.
  const root = useRef<HTMLElement | null>(null);
  const collapsible = useCollapsible({
    defaultOpen: true,
    keep: `decisions.panel:${taskId}`,
  });
  if (groups.status === "loading")
    return whenSettled === "hide" ? null : <Loading variant="rows" count={2} />;
  if (groups.status === "error")
    return (
      <ResourceErrorInline
        variant="block"
        subject="this agent's decisions"
        error={groups.error}
        refetch={groups.refetch}
      />
    );
  const countOf = (tab: string) =>
    groups.data.find((g) => g.value === tab)?.count ?? 0;
  const counts: Counts = {
    needs: countOf("needs"),
    fyi: countOf("fyi"),
    open: countOf("needs") + countOf("sent") + countOf("fyi"),
    closed: countOf("closed"),
  };
  // Sent decisions wait on the agent: the tray stays away until the agent
  // acts on them (an update or a reply brings one back to Needs you).
  if (whenSettled === "hide" && counts.needs + counts.fyi === 0) return null;
  const { open, triggerProps, contentProps } = collapsible;
  return (
    <Text as="div" variant="caption">
      <Clip
        ref={root}
        className="rounded-md border border-border bg-muted/30"
        data-testid="decisions-panel"
      >
        <Line className="gap-sm px-md py-sm">
          <Line
            as="button"
            {...triggerProps}
            data-testid="decisions-panel-header"
            className={cn(
              fillClasses("x"),
              "gap-sm text-left hover:bg-foreground/[0.03]",
            )}
          >
            <CollapsibleChevron
              open={open}
              className={cn("size-4 text-muted-foreground", rigidClass())}
            />
            <Fill as="span">
              <HeaderWords counts={counts} />
            </Fill>
          </Line>
          <Button variant="ghost" {...activationProps(inboxLink)}>
            Open in Decisions
          </Button>
        </Line>
        <FoldMotion {...contentProps}>
          {/* Capped and scrolled on its own: an open decision is long, and an
              unbounded panel would push the composer under it off-screen.
              Kept across a reload under the pane's keep scope, per task (a
              page may hold several tasks' panels). */}
          <Scroll
            keep={`decisions.panel:${taskId}`}
            className="max-h-[60vh] border-t border-border/60 bg-background/40"
          >
            <OpenDecisions taskId={taskId} />
            {counts.closed > 0 ? (
              <ClosedDecisions taskId={taskId} count={counts.closed} />
            ) : null}
            <SubmitBar taskId={taskId} region={root} />
          </Scroll>
        </FoldMotion>
      </Clip>
    </Text>
  );
}

/** "2 decisions need you", "1 open decision", "No open decision". */
function HeaderWords({ counts }: { counts: Counts }): ReactElement {
  if (counts.needs > 0)
    return (
      <>
        <span className="font-medium">{counts.needs}</span>
        {counts.needs === 1 ? " decision needs you" : " decisions need you"}
      </>
    );
  return (
    <span className="text-muted-foreground">
      {counts.open === 0
        ? "No open decision"
        : counts.open === 1
          ? "1 open decision, nothing needs you"
          : `${counts.open} open decisions, nothing needs you`}
    </span>
  );
}

/** The hosted DataViews draw no band: the panel's header is theirs. */
function BodyOnly({ body }: HostedToolbarParts): ReactElement {
  return <>{body}</>;
}
const HOSTED = { kind: "hosted", frame: BodyOnly } as const;

/**
 * A row's label before its title: "D3 Cache the HTML?". One inline run, so it
 * truncates as the row's title: a `<Text>` here would be a truncating block
 * of its own (the single-line row's leaf) and push the title under it.
 */
function Labelled({
  label,
  text,
}: {
  label: string;
  text: string;
}): ReactElement {
  return (
    <>
      <span
        className={cn(useTextVariantClass("code"), "text-muted-foreground")}
      >
        {label}
      </span>{" "}
      {text}
    </>
  );
}

// What the panel never prints: the task is the panel's, the tab its rows' scope.
const HIDDEN = {
  taskTitle: { visible: false },
  taskId: { visible: false },
  tab: { visible: false },
  state: { visible: false },
  label: { visible: false },
  fromDecisionId: { visible: false },
  openedAt: { visible: false },
  updatedAt: { visible: false },
  closedAt: { visible: false },
  pendingQuestions: { visible: false },
  unconsumedAnswers: { visible: false },
} as const;

const openOverrides = fieldOverrides(decisionsList, {
  ...HIDDEN,
  question: {
    primary: true,
    cell: (r) => <Labelled label={r.label} text={r.question} />,
  },
  outcome: { visible: false },
  isNew: { cell: (r) => (r.isNew ? <NewMark /> : null) },
});

const closedOverrides = fieldOverrides(decisionsList, {
  ...HIDDEN,
  question: { visible: false },
  outcome: {
    primary: true,
    cell: (r) => {
      // The record's CHECK: a closed decision holds its outcome.
      if (r.outcome === null)
        throw new Error(`decision ${r.id}: closed without an outcome`);
      return <Labelled label={r.label} text={r.outcome} />;
    },
  },
  isNew: { visible: false },
});

const OPEN_PLACE = {
  pill: "lead",
  isNew: "afterTitle",
  draft: "trail",
} as const;

const CLOSED_PLACE = { pill: "lead" } as const;

/**
 * A decision expanded in place under its row: marked seen while shown,
 * answered with its draft while it is answerable (the card's own rule — never
 * a closed one). The row stays its heading: `under` is what the row prints.
 */
function ShownDecision({
  decision,
  under,
}: {
  decision: DecisionRow;
  under: "question" | "outcome";
}): ReactElement {
  // What was new when it opened stays marked while it is shown.
  const [seenBefore] = useState(decision.seenAt);
  useMarkDecisionSeen(decision);
  const draft = useDecisionDrafts().part(decision.id);
  return (
    <DecisionCard
      decision={decision}
      seenBefore={seenBefore}
      draft={draft}
      under={under}
    />
  );
}

// An open row prints its question, a closed row its outcome (the overrides
// above). `fold`: an open row and its card are one block, the row its heading.
const OPEN_LIST_OPTIONS = {
  list: {
    detail: (r: DecisionRow) => (
      <ShownDecision key={r.id} decision={r} under="question" />
    ),
    detailOnActivate: true,
    frame: "fold",
    // One decision open at a time: opening one folds the one read before.
    detailExclusive: true,
    lines: 1,
  },
} as const;
const CLOSED_LIST_OPTIONS = {
  list: {
    detail: (r: DecisionRow) => (
      <ShownDecision key={r.id} decision={r} under="outcome" />
    ),
    detailOnActivate: true,
    frame: "fold",
    // One decision open at a time: opening one folds the one read before.
    detailExclusive: true,
    lines: 1,
  },
} as const;

/** The task's open decisions — Needs you first, then Sent and FYI. */
function OpenDecisions({ taskId }: { taskId: TaskId }): ReactElement {
  const { drafts } = useDecisionDrafts();
  const fields = useMemo(
    () => [decisionPillField, decisionDraftField(drafts)],
    [drafts],
  );
  const source = useMemo(
    () => openSource.scoped({ where: { taskId, tab: { ne: "closed" } } }),
    [taskId],
  );
  return (
    <DataView<DecisionRow>
      source={source}
      overrides={openOverrides}
      extraFields={fields}
      recipe="inbox"
      place={OPEN_PLACE}
      views={["list"]}
      viewOptions={OPEN_LIST_OPTIONS}
      toolbar={HOSTED}
      density="compact"
      emptyState={<>Nothing open.</>}
    />
  );
}

/** The task's closed decisions behind one "N closed" row; each line its outcome. */
function ClosedDecisions({
  taskId,
  count,
}: {
  taskId: TaskId;
  count: number;
}): ReactElement {
  const { open, triggerProps, contentProps } = useCollapsible({
    keep: `decisions.panel-closed:${taskId}`,
  });
  const source = useMemo(
    () => closedSource.scoped({ where: { taskId, tab: "closed" } }),
    [taskId],
  );
  return (
    <>
      <Line
        as="button"
        {...triggerProps}
        // A row of the panel's width (its parent is a block, not a flex row).
        className="w-full gap-sm rail-follow py-sm text-left text-muted-foreground hover:bg-foreground/[0.03]"
      >
        <CollapsibleChevron
          open={open}
          className={cn("size-4", rigidClass())}
        />
        <span>{`${count} closed`}</span>
      </Line>
      <FoldMotion {...contentProps}>
        <DataView<DecisionRow>
          source={source}
          overrides={closedOverrides}
          extraFields={CLOSED_FIELDS}
          recipe="inbox"
          place={CLOSED_PLACE}
          views={["list"]}
          viewOptions={CLOSED_LIST_OPTIONS}
          toolbar={HOSTED}
          density="compact"
          emptyState={<>Nothing closed.</>}
        />
      </FoldMotion>
    </>
  );
}

const CLOSED_FIELDS = [decisionPillField];
