import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { IdKinds } from "@plugins/ids/web";
import { decisionExchangeIdKind, decisionIdKind } from "../core";

export { DecisionCard } from "./components/decision-card";
export { NewMark } from "./components/decision-state";
export {
  decisionPresentation,
  type DecisionPresentation,
} from "./internal/presentation";
export { useMarkDecisionSeen } from "./internal/use-mark-seen";

export default {
  description:
    "Agent decisions, web half: registers the dec and dex id kinds, and the pieces every decision surface shares — DecisionCard (one decision in full: label, state pill, new mark, lineage, question, outcome or Split into, markdown body, one-sentence options with a muted Recommended, the latest exchange with earlier ones folded), decisionPresentation (the pill a state wears) and useMarkDecisionSeen. The surfaces (the inbox, the conversation tray, the page block) are its sub-plugins.",
  contributions: [
    IdKinds.Kind({ kind: decisionIdKind }),
    IdKinds.Kind({ kind: decisionExchangeIdKind }),
  ],
} satisfies PluginDefinition;
