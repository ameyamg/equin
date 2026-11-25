import { getConfig } from "@plugins/config_v2/server";
import { Mandate } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { reportRequired } from "@plugins/tasks/plugins/outcome-report/plugins/capability/core";
import { outcomeReportPromptsConfig } from "../../core";
import { reportRequiredLine } from "./report-line";

/** How `report.required` reads in the agent's `## Mandate` section: only
 * what the tool and the stop gate do not say — that nobody is watching. The
 * tool's description and the stop gate carry "end with the report". The
 * words are `outcomeReportPromptsConfig`'s, as the user saved them. */
export const reportRequiredCapability = Mandate.Capability({
  cap: reportRequired,
  describe: () => reportRequiredLine(getConfig(outcomeReportPromptsConfig)),
});
