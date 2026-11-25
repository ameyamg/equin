import { db } from "@plugins/database/server";
import { implementMachine } from "@plugins/infra/plugins/endpoints/machine";
import { recordVersion } from "@plugins/history/plugins/engine/server";
import { deliverEventTurn } from "@plugins/tasks/plugins/orchestration/plugins/message/server";
import { submitDecisionAnswersEndpoint } from "../../core";
import { DECISION_HISTORY_SOURCE } from "../../server/internal/history";
import { takeDecisionNote } from "./take-note";
import { taskAgentFinished } from "./agent-finished";
import { submitAnswers, type AnswerPorts } from "./answers";

const ports: AnswerPorts = {
  isFinished: taskAgentFinished,
  deliver: deliverEventTurn,
  recordVersion: (id) => recordVersion(DECISION_HISTORY_SOURCE, id),
  takeNote: takeDecisionNote,
};

/** The user's Submit: every drafted answer, one event turn per agent. */
export const handleSubmitDecisionAnswers = implementMachine(
  submitDecisionAnswersEndpoint,
  ({ body }) => submitAnswers(db, body, ports),
);
