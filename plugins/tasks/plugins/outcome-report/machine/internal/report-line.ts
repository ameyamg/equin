import {
  fillPrompt,
  type PromptText,
} from "@plugins/config_v2/plugins/prompts/core";
import { outcomeReportPromptsConfig } from "../../core";

export const OUTCOME_REPORT_TOOL = "submit_outcome_report";

/** The `report.required` Mandate line, from the config's values (`getConfig`
 * in production, its defaults in a test). */
export function reportRequiredLine(
  prompts: typeof outcomeReportPromptsConfig.defaults,
): PromptText {
  return fillPrompt(outcomeReportPromptsConfig, prompts, "mandateLine", {
    reportTool: OUTCOME_REPORT_TOOL,
  });
}
