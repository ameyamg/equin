import { z } from "zod";
import { parsed } from "@plugins/database/plugins/sql-projection/server";
import {
  expr,
  type LookupJoin,
} from "@plugins/network/plugins/live/plugins/query-resource/core";
import {
  serveCollection,
  type ServeCollectionOptions,
} from "@plugins/network/plugins/live/server";
import { _tasks } from "@plugins/tasks/plugins/tasks-core/server";
import {
  DECISION_TABS,
  decisionExchanges,
  decisionsList,
  type DecisionRow,
} from "../../core";
import {
  decisionExchangeFacts,
  decisionIsNewSql,
  decisionTabSql,
} from "./facts";
import { _decisions, decisionExchangesEntity, decisionsEntity } from "./tables";

/** A decision's task: REQUIRED (INNER) — `decisions.task_id` is a NOT NULL cascade FK. A rename reaches its decisions through the reverse route on `tasks.id`. */
const taskJoin = {
  kind: "lookup",
  alias: "task",
  table: _tasks,
  pk: _tasks.id,
  on: { from: "base", col: _decisions.taskId },
  required: true,
} as const satisfies LookupJoin<"task", typeof _tasks>;

const joins = [decisionExchangeFacts.join(), taskJoin] as const;

// `decisions.list`: the `decisions` table, its thread's stored facts and its
// task's title. A decision write is its row's refill; an exchange write moves
// the window only when it moved a stored fact (a reply clears a pending
// question, an answer is consumed); a task rename refills its decisions.
export const decisionsListServeOptions = {
  from: decisionsEntity,
  joins,
  columns: {
    tab: (j) =>
      expr(decisionTabSql(j.base.state, j.facts.unconsumedAnswers), {
        decoder: parsed(z.enum(DECISION_TABS), "decisions.tab"),
        sqlType: "text",
        notNull: true,
      }),
    taskTitle: (j) => j.task.title,
    pendingQuestions: (j) => j.facts.pendingQuestions,
    unconsumedAnswers: (j) => j.facts.unconsumedAnswers,
    latestAgentAt: (j) => j.facts.latestAgentAt,
    isNew: (j) =>
      expr(decisionIsNewSql(j.base.seenAt, j.facts.latestAgentAt), {
        decoder: Boolean,
        sqlType: "boolean",
        notNull: true,
      }),
  },
} satisfies ServeCollectionOptions<
  typeof decisionsEntity,
  DecisionRow,
  typeof joins,
  never
>;

export const decisionsListServed = serveCollection(
  decisionsList,
  decisionsListServeOptions,
);

// One decision's thread, whole per decision: an exchange write is its own
// row's refill (an insert an entrant).
export const decisionExchangesServed = serveCollection(decisionExchanges, {
  from: decisionExchangesEntity,
});
