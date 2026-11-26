import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { ConfigV2 } from "@plugins/config_v2/web";
import { DynamicEnum } from "@plugins/fields/plugins/dynamic-enum/plugins/config/web";
import { useModelChoiceOptions } from "@plugins/conversations/plugins/model-provider/web";
import { DecisionCardSlots } from "@plugins/tasks/plugins/decisions/web";
import { decisionAskConfig } from "../core";
import { DecisionAskArea, DecisionAskToggle } from "./components/decision-ask";

export default {
  description:
    "A decision's side chat, web half: a chat icon on the right of the answer's editor, beside the note's (a dot while the decision has a thread and the chat is closed), opening the chat above the answer box — the first question's box, then the agent's thread (AgentThread, its own reply box last, the answer field still below it) — on every surface a decision is answered in (the inbox, the conversation tray, the page block). One thread per decision: its task is filed about the decision (tasks/task-subject) under Decision questions, so it is found again after a reload. Nothing in it reaches the agent that asked. Registers the decision chat config with its model picker.",
  contributions: [
    DecisionCardSlots.AboveAnswer({ id: "ask", component: DecisionAskArea }),
    DecisionCardSlots.AnswerAction({
      id: "ask-toggle",
      component: DecisionAskToggle,
    }),
    ConfigV2.WebRegister({ descriptor: decisionAskConfig }),
    DynamicEnum.Options({
      field: decisionAskConfig.fields.model,
      useOptions: useModelChoiceOptions,
    }),
  ],
} satisfies PluginDefinition;
