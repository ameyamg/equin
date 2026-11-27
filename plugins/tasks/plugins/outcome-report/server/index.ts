import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ConfigV2 } from "@plugins/config_v2/server";
import { outcomeReportPromptsConfig } from "../core";
import { outcomeReportHandedBack } from "./internal/tables-events";

export {
  outcomeReportHandedBack,
  _outcomeReportHandedBackTriggers,
} from "./internal/tables-events";
export type { OutcomeReportHandedBackPayload } from "./internal/tables-events";

export default {
  description:
    "Outcome reports — how an agent nobody watches hands its run back: owns outcome_report_handbacks (each conversation's latest hand-back: which message, when) and outcome_report_turn_addressees (whom an agent said its latest turn is for, `user` or `supervisor`), registers the report.required Mandate line (a prompt config, Settings → Config), and declares the outcomeReport.handedBack event a hand-back emits (the agent's last message). The hand-back at the turn's end, the turn_for MCP tool and its stop gate, the question bell and the watch sources are the machine half.",
  contributions: [
    ConfigV2.Register({ descriptor: outcomeReportPromptsConfig }),
  ],
  register: [outcomeReportHandedBack],
} satisfies ServerPluginDefinition;
