import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { DecisionCardSlots } from "@plugins/tasks/plugins/decisions/web";
import {
  DecisionNoteArea,
  DecisionNoteToggle,
} from "./components/decision-note";

export default {
  description:
    "A private note on each decision, never sent to the agent: a note icon on the right of the answer's editor opens it (a dot while it has text), and the auto-saved note shows above the answer box — on every surface a decision is answered in (the inbox, the conversation tray, the page block), and still shown once the decision is closed.",
  contributions: [
    DecisionCardSlots.AboveAnswer({ id: "note", component: DecisionNoteArea }),
    DecisionCardSlots.AnswerAction({
      id: "note-toggle",
      component: DecisionNoteToggle,
    }),
  ],
} satisfies PluginDefinition;
