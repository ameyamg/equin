import { defineConfig } from "@plugins/config_v2/core";
import { promptField } from "@plugins/config_v2/plugins/prompts/core";
import { dynamicEnumField } from "@plugins/fields/plugins/dynamic-enum/plugins/config/core";
import {
  DECISION_ASK_INSTRUCTIONS_TEMPLATE,
  DECISION_ASK_INSTRUCTIONS_VARIABLES,
} from "./instructions";

/**
 * A decision's side chat settings (Settings → Config): the model (picked from
 * the live model catalog; the web barrel contributes its options, a stored
 * value is read through `normalizeModelChoice`) and the agent's whole
 * CLAUDE.md, filled at each launch.
 */
export const decisionAskConfig = defineConfig({
  fields: {
    model: dynamicEnumField({
      label: "Model",
      description: "The model that answers your questions about a decision.",
      default: "opus",
    }),
    instructions: promptField({
      label: "Instructions",
      description:
        "The side chat agent's whole prompt (its CLAUDE.md), read when a decision's chat starts.",
      default: DECISION_ASK_INSTRUCTIONS_TEMPLATE,
      rows: 24,
      variables: DECISION_ASK_INSTRUCTIONS_VARIABLES,
    }),
  },
});
