import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
  aggregate,
  childrenJoin,
  type AggregateRef,
  type ColumnRef,
} from "@plugins/network/plugins/live/plugins/query-resource/core";
import { materializeJoin } from "@plugins/network/plugins/live/plugins/query-resource/server";
import { _decisionExchangeFacts } from "./rollup-table";
import { _decisionExchanges, _decisions } from "./tables";

// A decision's thread, as the facts every surface derives from: stored per
// decision (`decision_exchange_facts`, a `materializeJoin` of the exchanges by
// `decision_id`), so the `decisions.list` window filters, sorts and groups by
// the derived `tab` like a column, and an exchange write reaches the window
// as a write to its decision's side row — only when a fact moved.

const count = (expression: SQL) =>
  aggregate(expression, {
    decoder: Number,
    sqlType: "integer",
    notNull: true,
    ifNone: sql`0`,
  });

export const decisionExchangeFacts = materializeJoin(
  childrenJoin({
    alias: "facts",
    table: _decisionExchanges,
    fk: _decisionExchanges.decisionId,
    aggregates: (c) => ({
      pendingQuestions: count(
        sql`(count(*) FILTER (WHERE ${c.facts.kind} = 'question' AND ${c.facts.agentText} IS NULL))::int`,
      ),
      unconsumedAnswers: count(
        sql`(count(*) FILTER (WHERE ${c.facts.kind} = 'answer' AND ${c.facts.consumedAt} IS NULL))::int`,
      ),
      latestAgentAt: aggregate(sql`max(${c.facts.agentAt})`, {
        decoder: _decisionExchangeFacts.latestAgentAt,
        sqlType: "timestamp with time zone",
      }),
    }),
  }),
  { host: _decisions, table: _decisionExchangeFacts },
);

/** A value `sql` interpolates: a column, a fragment, or a compile's column or aggregate ref. */
type SqlOperand =
  SQLWrapper | ColumnRef | AggregateRef<string, string, unknown>;

/**
 * The inbox tab (`DECISION_TABS`, core) of a decision in `state` whose thread
 * holds `unconsumedAnswers` answers the agent has not acted on — the ONE
 * definition: the live window's `tab` and `list_decisions` both render it.
 */
export function decisionTabSql(
  state: SqlOperand,
  unconsumedAnswers: SqlOperand,
): SQL {
  return sql`(CASE
    WHEN ${state} = 'closed' THEN 'closed'
    WHEN ${unconsumedAnswers} > 0 OR ${state} = 'other' THEN 'sent'
    WHEN ${state} = 'fyi' THEN 'fyi'
    ELSE 'needs' END)`;
}

/** Whether the user has something new to read on a decision: never opened, or the agent wrote in its thread since. */
export function decisionIsNewSql(
  seenAt: SqlOperand,
  latestAgentAt: SqlOperand,
): SQL {
  return sql`(${seenAt} IS NULL OR (${latestAgentAt} IS NOT NULL AND ${latestAgentAt} > ${seenAt}))`;
}
