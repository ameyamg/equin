import { db } from "@plugins/database/server";
import { implementMachine } from "@plugins/infra/plugins/endpoints/machine";
import { recordVersion } from "@plugins/history/plugins/engine/server";
import { deliverEventTurn } from "@plugins/tasks/plugins/orchestration/plugins/message/server";
import {
  DECISION_HISTORY_SOURCE,
  submitDecisionAnswersEndpoint,
} from "../../core";
import { keepDecisionNote } from "./take-note";
import { taskAgentFinished } from "./agent";
import { submitAnswers, type AnswerPorts } from "./answers";

const ports: AnswerPorts = {
  isFinished: taskAgentFinished,
  // A finished agent's answer is kept on the record, never sent: it is not reopened.
  deliver: (taskId, turn) =>
    deliverEventTurn(taskId, turn, { ifClosed: "leave" }),
  recordVersion: (id) => recordVersion(DECISION_HISTORY_SOURCE, id),
  keepNote: keepDecisionNote,
};

/** The user's Submit: every drafted answer, one event turn per agent. */
export const handleSubmitDecisionAnswers = implementMachine(
  submitDecisionAnswersEndpoint,
  ({ body }) => submitAnswers(db, body, ports),
);
