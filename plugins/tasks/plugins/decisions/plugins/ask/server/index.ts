import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ConfigV2 } from "@plugins/config_v2/server";
import { TaskCategory } from "@plugins/tasks/plugins/task-category/server";
import { DECISION_ASK_CATEGORY_ID, decisionAskConfig } from "../core";

export default {
  description:
    "A decision's side chat, server half: the decision chat config (the answering model, the agent's whole prompt as an editable template) and the Decision questions task category every side chat's task is filed under — its own, so a chat never lands in the asking agent's tree.",
  contributions: [
    ConfigV2.Register({ descriptor: decisionAskConfig }),
    TaskCategory({
      id: DECISION_ASK_CATEGORY_ID,
      label: "Decision questions",
      order: 21,
    }),
  ],
} satisfies ServerPluginDefinition;
