import type { LiveRowsCollection } from "@plugins/network/plugins/live/core";
import { liveCollection, liveValue } from "@plugins/network/plugins/live/core";
import { z } from "zod";
import { nullable } from "@plugins/fields/core";
import { boolField } from "@plugins/fields/plugins/bool/plugins/config/core";
import { dateField } from "@plugins/fields/plugins/date/plugins/config/core";
import { intField } from "@plugins/fields/plugins/int/plugins/config/core";
import {
  enumTextField,
  textField,
} from "@plugins/fields/plugins/text/plugins/config/core";
import {
  decisionExchangesEntityRef,
  decisionsEntityRef,
  EXCHANGES_PER_DECISION_MAX,
} from "./fields";
import { DECISION_TAB_OPTIONS, DECISION_TABS } from "./tab";

/**
 * Every decision, with what the surfaces show beside it — the inbox's window
 * (its tabs are `where: { tab }` sources, its counts a grouping of `tab`), a
 * task's decisions (`where: { taskId }`, the tray and the page block), one
 * decision by id (`:rows`) and the decisions split from one
 * (`where: { fromDecisionId }`). Served from the `decisions` table with its
 * thread's facts materialized per decision (`server/internal/facts.ts`) and
 * the task's current title, never a view.
 *
 * - `tab` — the derived inbox tab (`DECISION_TABS`, `core/internal/tab.ts`).
 * - `pendingQuestions` — the user's questions the agent has not replied to.
 * - `unconsumedAnswers` — answers the agent has not acted on yet.
 * - `latestAgentAt` — the agent's latest reply or note in the thread.
 * - `isNew` — the user has not opened it since it was opened, or since the
 *   agent last wrote in its thread.
 */
export const decisionsList = liveCollection("decisions.list", {
  from: decisionsEntityRef,
  pick: [
    "label",
    "state",
    "question",
    "outcome",
    "taskId",
    "fromDecisionId",
    "openedAt",
    "updatedAt",
    "closedAt",
  ],
  fields: {
    tab: enumTextField(DECISION_TABS, {
      label: "Tab",
      ordered: true,
      options: DECISION_TAB_OPTIONS,
    }),
    taskTitle: textField({ label: "Agent" }),
    pendingQuestions: intField({ label: "Questions" }),
    unconsumedAnswers: intField({ label: "Answers not acted on" }),
    isNew: boolField({ label: "New" }),
  },
  carry: {
    pick: [
      "id",
      "stateLabel",
      "body",
      "options",
      "openedByConversationId",
      "seenAt",
    ],
    fields: { latestAgentAt: nullable(dateField()) },
  },
  id: "id",
  sortable: ["openedAt", "updatedAt", "closedAt", "tab"],
  default: { orderBy: [["openedAt", "desc"]], limit: 100 },
  maxLimit: 500,
  count: true,
});

/** One decision, as every surface reads it. */
export type DecisionRow =
  typeof decisionsList extends LiveRowsCollection<infer R> ? R : never;

/**
 * One decision's thread, oldest first (`where: { decisionId }`): the card shows
 * the latest, the earlier ones folded. Whole per decision — the writes refuse
 * past {@link EXCHANGES_PER_DECISION_MAX}.
 */
export const decisionExchanges = liveCollection("decisions.exchanges", {
  from: decisionExchangesEntityRef,
  pick: [
    "kind",
    "pick",
    "userText",
    "agentText",
    "agentAt",
    "consumedAt",
    "createdAt",
  ],
  carry: { pick: ["id", "decisionId", "turnId"] },
  id: "id",
  all: {
    by: ["decisionId"],
    orderBy: [["createdAt", "asc"]],
    max: EXCHANGES_PER_DECISION_MAX,
  },
});

/** One exchange of a decision's thread. */
export type DecisionExchangeRow =
  typeof decisionExchanges extends LiveRowsCollection<infer R> ? R : never;

/**
 * Whether a task's agent has finished — its latest conversation under the
 * task's mandate is closed (`done`): an answer to one of its decisions is
 * kept on the record, never sent (it is not reopened). `false` while it runs,
 * is stopped (resumed on delivery) or never ran. The same reading delivery
 * takes (message's `latestAgentConversation`).
 */
export const decisionAgentFinished = liveValue("decisions.agent-finished", {
  schema: z.boolean(),
  params: ["taskId"],
  needsMachine: { feature: "Reading whether an agent has finished" },
});
