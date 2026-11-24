import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { idChip } from "@plugins/active-data/plugins/id-chip/web";
import { opensPane } from "@plugins/primitives/plugins/app-shell/web";
import { Pane } from "@plugins/primitives/plugins/pane/web";
import { Shell } from "@plugins/shell/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { decisionIdKind } from "@plugins/tasks/plugins/decisions/core";
import { DECISION_CHIP_SURFACES } from "../core";
import {
  ClosedSource,
  FyiSource,
  NeedsSource,
  SentSource,
} from "./components/decisions-view";
import { NeedsYouCount } from "./components/needs-count";
import { useDecisionPane, useDecisionReferent } from "./internal/presenter";
import { decisionDetailPane, decisionsPane } from "./panes";
import { DecisionsSources } from "./slots";

export { decisionDetailPane, decisionsPane } from "./panes";

export default {
  description:
    "The Decisions inbox in the agent manager, read-only: the Decisions sidebar entry with the count of decisions that need the user (a grouping of the derived tab), the decisions pane — one view bar over the Needs you / Sent / FYI / Closed tabs (DecisionsSources, each the decisions.list window scoped by tab), grouped by the agent waiting on it, each row the state dot, question, new mark and label — and the decision detail beside it (the agent, then DecisionCard; opening it marks it seen). A `dec-…` id in a transcript is a chip opening that pane.",
  contributions: [
    Pane.Register({ pane: decisionsPane }),
    Pane.Register({ pane: decisionDetailPane }),
    Shell.Sidebar({
      id: "decisions",
      title: "Decisions",
      icon: symbol("inbox"),
      opens: opensPane(decisionsPane, {}),
      trail: NeedsYouCount,
    }),
    DecisionsSources({
      id: "needs",
      title: "Needs you",
      icon: symbol("inbox"),
      views: ["list"],
      component: NeedsSource,
    }),
    DecisionsSources({
      id: "sent",
      title: "Sent",
      icon: symbol("send"),
      views: ["list"],
      component: SentSource,
    }),
    DecisionsSources({
      id: "fyi",
      title: "FYI",
      icon: symbol("info"),
      views: ["list"],
      component: FyiSource,
    }),
    DecisionsSources({
      id: "closed",
      title: "Closed",
      icon: symbol("check-circle"),
      views: ["list"],
      component: ClosedSource,
    }),
    ...idChip({
      presenter: {
        kind: decisionIdKind,
        icon: symbol("inbox"),
        useReferent: useDecisionReferent,
        usePane: useDecisionPane,
      },
      surfaces: DECISION_CHIP_SURFACES,
    }),
  ],
  slots: {
    decisions: decisionsPane,
    "decision-detail": decisionDetailPane,
    sources: DecisionsSources,
  },
} satisfies PluginDefinition;
