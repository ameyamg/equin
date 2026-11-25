import { getConfig } from "@plugins/config_v2/server";
import { Mandate } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { reportRequired } from "@plugins/tasks/plugins/outcome-report/plugins/capability/core";
import { outcomeReportPromptsConfig } from "../../core";
import { reportRequiredLine } from "./report-line";

/** How `report.required` reads in the agent's `## Mandate` section: nobody
 * is watching, ask with AskUserQuestion when blocked, the last message is the
 * report, and `turn_for` once the user has talked to it. The words are
 * `outcomeReportPromptsConfig`'s, as the user saved them. */
export const reportRequiredCapability = Mandate.Capability({
  cap: reportRequired,
  describe: () => reportRequiredLine(getConfig(outcomeReportPromptsConfig)),
});
