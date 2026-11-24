import { useLive } from "@plugins/network/plugins/live/web";
import {
  paneTarget,
  type PaneTarget,
} from "@plugins/primitives/plugins/pane/web";
import { rowReferent } from "@plugins/active-data/plugins/id-chip/web";
import type { IdReferentState } from "@plugins/ids/web";
import { decisionsList } from "@plugins/tasks/plugins/decisions/core";
import { decisionDetailPane } from "../panes";

/** A decision's chip title — its label and question — from the by-id row read. */
export function useDecisionReferent(id: string): IdReferentState {
  return rowReferent(
    useLive(decisionsList, { id }),
    (d) => `${d.label}: ${d.question}`,
  );
}

/** The decision's detail pane. */
export function useDecisionPane(id: string): PaneTarget {
  return paneTarget(decisionDetailPane, { decisionId: id });
}
