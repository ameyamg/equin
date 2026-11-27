import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Conversation } from "@plugins/conversations/plugins/conversation-view/web";
import { Pane } from "@plugins/primitives/plugins/pane/web";
import { DecisionsTray } from "./components/decisions-tray";
import { convDecisionsPane } from "./panes";

export default {
  description:
    "An agent's decisions in its conversation: a tray above the composer drawing the task's TaskDecisionsPanel — \"N decisions need you\" (a click on it folds the tray), one row per open decision expanding inline into its card, answered in place with the inbox's drafts, a collapsed N closed row, the Submit scoped to this agent and Open in Decisions; its side-pane icon opens the same decisions in a Decisions pane beside the conversation (convDecisionsPane), the tray folding to its header while that pane is open. Absent while no decision waits on the user (none in Needs you or FYI; a Sent one waits on the agent).",
  contributions: [
    Conversation.AbovePromptInput({
      id: "decisions",
      requires: [],
      component: DecisionsTray,
    }),
    Pane.Register({ pane: convDecisionsPane }),
  ],
  slots: { "conv-decisions": convDecisionsPane },
} satisfies PluginDefinition;
