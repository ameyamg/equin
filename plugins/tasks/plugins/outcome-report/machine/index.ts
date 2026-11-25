import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { Trigger } from "@plugins/infra/plugins/events/server";
import { conversationTurnCompleted } from "@plugins/conversations/server";
import { conversationStatusChanged } from "@plugins/tasks/plugins/tasks-core/server";
import { turnForTool } from "./internal/turn-for";
import { reportRequiredCapability } from "./internal/capability";
import { turnForStopGate } from "./internal/stop-gate";
import { handBackBackstopJob, handBackJob } from "./internal/handback";
import { questionBellJob } from "./internal/question-bell";
import {
  askingWatchSource,
  outcomeReportWatchSource,
} from "./internal/watch-source";
import { outcomeReportDigestAnnotation } from "./internal/annotation";

export default {
  description:
    "Outcome reports, desktop-only half: a run is handed back at its turn's end (outcome-report.hand-back on conversation.turn-completed — the agent's last message becomes the task's report, then outcomeReport.submitted — with outcome-report.hand-back-backstop on every stop for a turn whose end was never announced), the turn_for MCP tool (gated on the report.required grant: once the user has talked to the agent, it says whether a turn is for the user or its supervisor) and its stop gate, the bell when such an agent waits on its AskUserQuestion, the `outcome-report` (reported) and `outcome-report.asking` (asking) watch sources, the capability's describe and the `report: …` digest words — an agent session's surface, which exists only on a host that runs agents (a hand-back measures the attempt from git).",
  contributions: [
    reportRequiredCapability,
    turnForStopGate,
    Trigger({
      on: conversationTurnCompleted,
      do: handBackJob,
      with: {},
      oneShot: false,
    }),
    Trigger({
      on: conversationStatusChanged,
      do: handBackBackstopJob,
      with: {},
      oneShot: false,
    }),
    Trigger({
      on: conversationStatusChanged,
      do: questionBellJob,
      with: {},
      oneShot: false,
    }),
    ...outcomeReportWatchSource,
    ...askingWatchSource,
    outcomeReportDigestAnnotation,
  ],
  register: [turnForTool, handBackJob, handBackBackstopJob, questionBellJob],
} satisfies MachinePluginDefinition;
