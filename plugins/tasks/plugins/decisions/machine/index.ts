import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { submitDecisionAnswersEndpoint } from "../core";
import { decisionAgentFinishedServed } from "./internal/agent-finished";
import { handleSubmitDecisionAnswers } from "./internal/answers-endpoint";
import { decisionsExitGate, decisionsStopGate } from "./internal/gates";

export default {
  description:
    "Agent decisions, desktop-only half — answering, which types into agents: POST /api/decisions/answers takes the user's batch of answers — one event turn per agent carrying all of its picks and questions (deliverEventTurn, the exchanges committed with the turn, idempotent per submission), an answer to a finished agent kept on the record (a pick closes it, not sent) and never reopening it, Got it closing an FYI — decisions.agent-finished, whether a task's agent has finished, read beside a drafted answer; and what the agent owes — the decisions.owed stop gate (its task's latest agent conversation may not stop while a question the user sent waits for a reply or an answer waits to be acted on) and the decisions.unsettled exit_clean precondition (also while a decision or action still waits on the user).",
  contributions: [
    ...decisionAgentFinishedServed.declare,
    decisionsStopGate,
    decisionsExitGate,
  ],
  httpRoutes: {
    [submitDecisionAnswersEndpoint.route]: handleSubmitDecisionAnswers,
  },
} satisfies MachinePluginDefinition;
