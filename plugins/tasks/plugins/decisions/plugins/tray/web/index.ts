import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Conversation } from "@plugins/conversations/plugins/conversation-view/web";
import { DecisionsTray } from "./components/decisions-tray";

export default {
  description:
    "An agent's decisions in its conversation: a tray above the composer drawing the task's TaskDecisionsPanel — \"N decisions need you\" (a click on it folds the tray), one row per open decision expanding inline into its card, answered in place with the inbox's drafts, a collapsed N closed row, the Submit scoped to this agent and Open in Decisions. Absent while no decision waits on the user (none in Needs you or FYI; a Sent one waits on the agent).",
  contributions: [
    Conversation.AbovePromptInput({
      id: "decisions",
      requires: [],
      component: DecisionsTray,
    }),
  ],
} satisfies PluginDefinition;
