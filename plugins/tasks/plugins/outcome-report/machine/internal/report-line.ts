import {
  fillPrompt,
  type PromptText,
} from "@plugins/config_v2/plugins/prompts/core";
import { outcomeReportPromptsConfig } from "../../core";

export const TURN_FOR_TOOL = "turn_for";

/** The `report.required` Mandate line, from the config's values (`getConfig`
 * in production, its defaults in a test). */
export function reportRequiredLine(
  prompts: typeof outcomeReportPromptsConfig.defaults,
): PromptText {
  return fillPrompt(outcomeReportPromptsConfig, prompts, "mandateLine", {
    turnForTool: TURN_FOR_TOOL,
  });
}
