import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { IdKinds } from "@plugins/ids/web";
import { decisionExchangeIdKind, decisionIdKind } from "../core";

export { DecisionCard, type AnsweredVia } from "./components/decision-card";
export { DecisionCardSlots } from "./slots";
import { DecisionCardSlots } from "./slots";
export { NewMark } from "./components/decision-state";
export {
  decisionPresentation,
  type DecisionPresentation,
} from "./internal/presentation";
export { useMarkDecisionSeen } from "./internal/use-mark-seen";
export { SubmitBar } from "./components/submit-bar";
export {
  TaskDecisions,
  TaskDecisionsPanel,
  type DecisionsBeside,
} from "./components/task-decisions-panel";
export {
  decisionDraftField,
  decisionPillField,
  draftWords,
} from "./internal/row-fields";
export {
  answerOf,
  decisionDrafts,
  EMPTY_DRAFT,
  isAnswerable,
  isDraftEmpty,
  useDecisionDrafts,
} from "./internal/drafts";
export type { DecisionDraft, DecisionDrafts } from "./internal/drafts";
export { useSendAnsweredSection } from "./internal/section-send";

export default {
  description:
    "Agent decisions, web half: registers the dec and dex id kinds, and the pieces every decision surface shares — DecisionCard (one decision in full: label, state pill, new mark, lineage, question, outcome or Split into, markdown body, one-sentence options with a muted Recommended, the latest exchange with earlier ones folded), decisionPresentation (the pill a state wears) and useMarkDecisionSeen; answering — the drafted answers (decisionDrafts: one browser-only kept work entry keyed by decision, shared by every surface; useDecisionDrafts' part(id) and submit), each agent's section sent on its own the moment all its open decisions are answered (useSendAnsweredSection: a pick, Enter in the note, Got it), DecisionCard answered in place given a draft (options pick, a note or a question, Got it on an FYI, Close on a finished agent's decision, which says its answer will be kept, not sent), SubmitBar — the one sticky Submit (⌘↵) sending every drafted answer, N of M answered, how many go to agents and how many are only kept — and TaskDecisionsPanel, one task's decisions as the conversation tray and the page block draw them (a header folding it, open rows expanding inline into their card, a collapsed N closed row, the Submit scoped to the task; given a side pane's toggle, an icon opening the decisions beside, the panel folding to its header while they are) and TaskDecisions, the same decisions unframed for a pane; the row fields every decision list shares (the state dot, the drafted answer). The surfaces (the inbox, the conversation tray, the page block) are its sub-plugins.",
  slots: DecisionCardSlots,
  contributions: [
    IdKinds.Kind({ kind: decisionIdKind }),
    IdKinds.Kind({ kind: decisionExchangeIdKind }),
  ],
} satisfies PluginDefinition;
