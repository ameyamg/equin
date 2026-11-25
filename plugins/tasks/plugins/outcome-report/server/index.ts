import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ConfigV2 } from "@plugins/config_v2/server";
import { outcomeReportPromptsConfig } from "../core";
import { outcomeReportRowsServed } from "./internal/resource";
import { outcomeReportSubmitted } from "./internal/tables-events";

export {
  outcomeReportSubmitted,
  _outcomeReportSubmittedTriggers,
} from "./internal/tables-events";
export type { OutcomeReportSubmittedPayload } from "./internal/tables-events";

export default {
  description:
    "Outcome reports: owns tasks_ext_outcome_report (one report per task — the agent's last message of the run it handed back, markdown, and the attempt's git-measured standing) and outcome_report_turn_addressees (whom an agent said its latest turn is for, `user` or `supervisor`), serves the outcome-reports lookup collection, registers the report.required Mandate line (a prompt config, Settings → Config), and declares the outcomeReport.submitted event a hand-back emits. The hand-back at the turn's end, the turn_for MCP tool and its stop gate, the question bell and the watch sources are the machine half.",
  contributions: [
    ...outcomeReportRowsServed.declare,
    ConfigV2.Register({ descriptor: outcomeReportPromptsConfig }),
  ],
  register: [outcomeReportSubmitted],
} satisfies ServerPluginDefinition;
