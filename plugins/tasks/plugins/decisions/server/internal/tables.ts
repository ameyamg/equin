import { sql } from "drizzle-orm";
import {
  check,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  defaultNow,
  defineEntity,
} from "@plugins/infra/plugins/entities/server";
import { _tasks } from "@plugins/tasks/plugins/tasks-core/server";
import { decisionExchangesEntityRef, decisionsEntityRef } from "../../core";

// Physical tables, derived from the refs in `core/`. A load-order leaf
// (drizzle-kit's sync loader evaluates it); the pgTables are re-exported with
// a leading `_` for drizzle-kit's schema glob.

const decisionsEntity = defineEntity(decisionsEntityRef, {
  primaryKey: "id",
  columns: {
    // The owner. Growth bound: this cascade, and `open_decision` refusing
    // past DECISIONS_PER_TASK_MAX per task.
    taskId: {
      references: { column: () => _tasks.id, onDelete: "cascade" },
    },
    // No FK: "this conversation opened it" stays true after the
    // conversation's row goes (as authorship's does).
    body: { default: "" },
    options: { default: [] },
    fromDecisionId: {
      references: {
        column: (): AnyPgColumn => _decisions.id,
        onDelete: "set null",
      },
    },
    openedAt: { default: defaultNow() },
    updatedAt: { default: defaultNow() },
  },
  // What the decision SAYS moved; the user opening it (`seenAt`) does not.
  updatedAt: {
    touchedBy: {
      id: false,
      taskId: false,
      openedByConversationId: false,
      label: true,
      state: true,
      stateLabel: true,
      question: true,
      body: true,
      options: true,
      fromDecisionId: true,
      outcome: true,
      openedAt: false,
      closedAt: true,
      seenAt: false,
    },
  },
  indexes: (t) => [
    // A decision is addressed by its label within its task.
    uniqueIndex("decisions_task_label_idx").on(t.taskId, t.label),
    // The inbox's default order, with the pk tiebreak the window appends.
    index("decisions_opened_at_idx").on(t.openedAt, t.id),
    index("decisions_from_idx").on(t.fromDecisionId),
    check(
      "decisions_state_label_iff_other",
      sql`(${t.state} = 'other') = (${t.stateLabel} IS NOT NULL)`,
    ),
    check(
      "decisions_outcome_iff_closed",
      sql`(${t.state} = 'closed') = (${t.outcome} IS NOT NULL)`,
    ),
    check(
      "decisions_closed_at_iff_closed",
      sql`(${t.state} = 'closed') = (${t.closedAt} IS NOT NULL)`,
    ),
  ],
});
export const _decisions = decisionsEntity.table;
export { decisionsEntity };

const decisionExchangesEntity = defineEntity(decisionExchangesEntityRef, {
  primaryKey: "id",
  columns: {
    decisionId: {
      references: { column: () => _decisions.id, onDelete: "cascade" },
    },
    createdAt: { default: defaultNow() },
  },
  indexes: (t) => [
    index("decision_exchanges_decision_idx").on(t.decisionId, t.createdAt),
    check(
      "decision_exchanges_pick_kind",
      // An answer is a pick; a kept answer may be one; nothing else is.
      sql`CASE ${t.kind} WHEN 'answer' THEN ${t.pick} IS NOT NULL WHEN 'recorded' THEN true ELSE ${t.pick} IS NULL END`,
    ),
    check(
      "decision_exchanges_agent_text_at",
      sql`(${t.agentText} IS NULL) = (${t.agentAt} IS NULL)`,
    ),
    check(
      "decision_exchanges_update_has_text",
      sql`${t.kind} <> 'update' OR ${t.agentText} IS NOT NULL`,
    ),
  ],
});
export const _decisionExchanges = decisionExchangesEntity.table;
export { decisionExchangesEntity };
