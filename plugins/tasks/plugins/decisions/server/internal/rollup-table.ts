import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { DECISION_EXCHANGE_FACTS_TABLE } from "@plugins/database/plugins/derived-views/core";

// The drizzle READ handle for `decisionExchangeFacts`' materialized join
// (`./facts.ts`, query-resource's `materializeJoin`): one row per decision
// with a thread, keyed by the decision id, one column per aggregate by
// property name — asserted against the aggregates at module eval. Derived
// state created imperatively on boot (`DerivedTable`), so this file is
// outside the drizzle schema glob.
export const _decisionExchangeFacts = pgTable(DECISION_EXCHANGE_FACTS_TABLE, {
  decisionId: text("decision_id").primaryKey(),
  pendingQuestions: integer("pending_questions").notNull(),
  unconsumedAnswers: integer("unconsumed_answers").notNull(),
  latestAgentAt: timestamp("latest_agent_at", { withTimezone: true }),
});
