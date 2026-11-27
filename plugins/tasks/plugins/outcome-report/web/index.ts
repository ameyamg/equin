import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Automations } from "@plugins/tasks/plugins/automations/web";
import { ConfigV2 } from "@plugins/config_v2/web";
import { outcomeReportPromptsConfig } from "../core";
import { OutcomeReportDetail } from "./components/outcome-report-card";

export { OutcomeReportDetail } from "./components/outcome-report-card";

export default {
  description:
    "The outcome report a supervisor's worker or an automation's run handed back (its last message of the run, captured at the turn's end): OutcomeReportDetail — its markdown body and pushed / branch-waiting / no-changes standing — shown in an expanded row of an automation's History (Automations.TaskDetail). Not drawn in the conversation itself: the report is its last message, already shown just above.",
  contributions: [
    ConfigV2.WebRegister({ descriptor: outcomeReportPromptsConfig }),
    // An expanded row of an automation's History shows its task's report.
    Automations.TaskDetail({
      id: "outcome-report",
      component: OutcomeReportDetail,
    }),
  ],
} satisfies PluginDefinition;
