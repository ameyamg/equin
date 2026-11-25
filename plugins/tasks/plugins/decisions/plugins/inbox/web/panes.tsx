import { useRef, useState, type ReactElement } from "react";
import { rowOrStale, useLive } from "@plugins/network/plugins/live/web";
import {
  Pane,
  PaneChrome,
  resolveRow,
  useOpenPane,
  type ResolveResult,
} from "@plugins/primitives/plugins/pane/web";
import {
  selfClass,
  Stack,
} from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { activationProps } from "@plugins/primitives/plugins/link-gesture/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { agentManagerApp } from "@plugins/apps/plugins/agent-manager/plugins/shell/core";
import { taskDetailPane } from "@plugins/tasks/plugins/task-detail/web";
import {
  decisionsList,
  type DecisionRow,
} from "@plugins/tasks/plugins/decisions/core";
import {
  DecisionCard,
  isAnswerable,
  SubmitBar,
  useDecisionDrafts,
  useMarkDecisionSeen,
} from "@plugins/tasks/plugins/decisions/web";
import { useSurfaceShortcuts } from "@plugins/primitives/plugins/shortcuts/web";
import { decisionDetailRoute, decisionsRoute } from "../core";
import { DecisionsView } from "./components/decisions-view";

// Panes are declared first so their types are known before the component
// bodies reference them (the bodies are hoisted function declarations).

export const decisionsPane = Pane.define({
  title: "Decisions",
  route: decisionsRoute,
  app: agentManagerApp,
  component: DecisionsBody,
});

function useResolveDecision({
  decisionId,
}: {
  decisionId: string;
}): ResolveResult {
  return resolveRow(useLive(decisionsList, { id: decisionId }));
}

/** The decision's label and question, once read. */
function useDecisionTitle({
  decisionId,
}: {
  decisionId: string;
}): string | undefined {
  const d = rowOrStale(useLive(decisionsList, { id: decisionId }));
  return d === undefined ? undefined : `${d.label} · ${d.question}`;
}

// Detail (/agents/decisions/decision/<id>): one decision, open beside the list.
export const decisionDetailPane = Pane.define({
  route: decisionDetailRoute,
  app: agentManagerApp,
  useResolve: useResolveDecision,
  title: { useText: useDecisionTitle, fallback: "Decision" },
  component: DecisionDetailBody,
});

function DecisionsBody(): ReactElement {
  const openPane = useOpenPane();
  const selectedId = decisionDetailPane.useRouteEntry()?.params.decisionId;
  // The list and its Submit: where the bar's ⌘↵ belongs (a box of no
  // layout — the pane lays out its children as before).
  const region = useRef<HTMLDivElement | null>(null);
  return (
    <PaneChrome pane={decisionsPane}>
      <div ref={region} className="contents">
        <DecisionsView
          selectedId={selectedId}
          linkTo={(decisionId) =>
            openPane.to(decisionDetailPane, { decisionId }, { mode: "push" })
          }
        />
        <SubmitBar region={region} />
      </div>
    </PaneChrome>
  );
}

function DecisionDetailBody(): ReactElement {
  const { decisionId } = decisionDetailPane.useParams();
  const decision = useLive(decisionsList, { id: decisionId });
  return (
    <PaneChrome pane={decisionDetailPane}>
      {decision.status === "loading" ? (
        <Loading />
      ) : decision.status === "error" ? (
        <ResourceErrorInline
          variant="block"
          subject="the decision"
          error={decision.error}
          refetch={decision.refetch}
        />
      ) : decision.found ? (
        <DecisionDetail key={decisionId} decision={decision.row} />
      ) : (
        // The guard said it exists; it can still go under a mounted pane (its task deleted).
        <Text tone="muted">This decision no longer exists.</Text>
      )}
    </PaneChrome>
  );
}

/** One decision in full, under the agent it belongs to; opening it marks it seen. */
function DecisionDetail({ decision }: { decision: DecisionRow }): ReactElement {
  // What was new when it opened stays marked while it is shown, though opening it marks it seen.
  const [seenBefore] = useState(decision.seenAt);
  useMarkDecisionSeen(decision);
  const openPane = useOpenPane();
  const draft = useDecisionDrafts().part(decision.id);
  const answerable = isAnswerable(decision);
  // 1–9 pick the open decision's options (a second press unpicks); typing in
  // the note keeps its digits.
  useSurfaceShortcuts(
    decision.options.slice(0, 9).map((o, i) => ({
      id: `decisions.pick-${i + 1}`,
      keys: String(i + 1),
      label: `Pick option ${o.key}`,
      group: "Decisions",
      when: () => answerable,
      handler: () =>
        draft.set((d) => ({ ...d, pick: d.pick === o.key ? null : o.key })),
    })),
  );
  return (
    <Stack gap="md" className="rail-lg">
      <Button
        variant="ghost"
        className={selfClass("start")}
        {...activationProps(
          openPane.to(
            taskDetailPane,
            { taskId: decision.taskId },
            { mode: "push" },
          ),
        )}
      >
        {decision.taskTitle}
      </Button>
      <DecisionCard decision={decision} seenBefore={seenBefore} draft={draft} />
    </Stack>
  );
}
