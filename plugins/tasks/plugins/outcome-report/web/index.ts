import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { JsonlViewer } from "@plugins/conversations/plugins/conversation-view/plugins/jsonl-viewer/web";
import { Automations } from "@plugins/tasks/plugins/automations/web";
import { ConfigV2 } from "@plugins/config_v2/web";
import { outcomeReportPromptsConfig } from "../core";
import {
  OutcomeReportCard,
  OutcomeReportDetail,
} from "./components/outcome-report-card";

export { OutcomeReportDetail } from "./components/outcome-report-card";

export default {
  description:
    "The outcome report a supervisor's worker or an automation's run handed back (its last message of the run, captured at the turn's end): a card at the end of the transcript of the conversation that handed it back (scrolling with it, not pinned over it) — markdown body and pushed / branch-waiting / no-changes standing — and OutcomeReportDetail, the same report shown in an expanded row of an automation's History (Automations.TaskDetail).",
  contributions: [
    ConfigV2.WebRegister({ descriptor: outcomeReportPromptsConfig }),
    JsonlViewer.TranscriptEnd({
      id: "outcome-report",
      component: OutcomeReportCard,
    }),
    // An expanded row of an automation's History shows its task's report.
    Automations.TaskDetail({
      id: "outcome-report",
      component: OutcomeReportDetail,
    }),
  ],
} satisfies PluginDefinition;
