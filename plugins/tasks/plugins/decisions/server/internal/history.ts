import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@plugins/database/server";
import { defineHistorySource } from "@plugins/history/plugins/engine/server";
import {
  DECISION_OPTIONS_MAX,
  DECISION_STATES,
  decisionIdKind,
  DecisionOptionSchema,
} from "../../core";
import { cappedList } from "@plugins/packages/plugins/list-bound/core";
import { _decisions } from "./tables";

/** The history source id a decision's versions are recorded under. */
export const DECISION_HISTORY_SOURCE = "decision";

/**
 * What a version of a decision holds: what the decision SAYS — never its
 * thread (append-only on its own) nor who saw it. `closedAt` travels with
 * `state` and `outcome`, so a restored version keeps the table's CHECKs.
 */
const SnapshotSchema = z.object({
  label: z.string(),
  state: z.enum(DECISION_STATES),
  stateLabel: z.string().nullable(),
  question: z.string(),
  body: z.string(),
  options: cappedList(DecisionOptionSchema, { max: DECISION_OPTIONS_MAX }),
  outcome: z.string().nullable(),
  closedAt: z.string().nullable(),
});
type Snapshot = z.infer<typeof SnapshotSchema>;

/**
 * Every edit of a decision is a version (`history/engine`), so a decision has
 * the version dialog a page has. The tools record one after each write that
 * changed the decision, and pin the closed version before a reopen — the old
 * outcome is kept there, not on the row.
 */
export const decisionHistorySource = defineHistorySource({
  id: DECISION_HISTORY_SOURCE,
  serialize: async (entityId) => {
    const [row] = await db
      .select()
      .from(_decisions)
      .where(eq(_decisions.id, decisionIdKind.key(entityId)));
    if (row === undefined) return null; // deleted since (its task went)
    const snapshot: Snapshot = {
      label: row.label,
      state: row.state,
      stateLabel: row.stateLabel,
      question: row.question,
      body: row.body,
      options: row.options,
      outcome: row.outcome,
      closedAt: row.closedAt?.toISOString() ?? null,
    };
    return { snapshot, label: `${row.label} · ${row.question}` };
  },
  // A restore is the user's own undo: it may reopen or close the decision (the
  // engine pins the current version first). Its label only comes back when no
  // other decision of the task took it since — else the current one stays.
  restore: async (entityId, raw) => {
    const s = SnapshotSchema.parse(raw);
    const id = decisionIdKind.key(entityId);
    const [row] = await db
      .select({ taskId: _decisions.taskId })
      .from(_decisions)
      .where(eq(_decisions.id, id));
    if (row === undefined)
      throw new Error(
        `decisions: cannot restore ${entityId}, it no longer exists`,
      );
    const [holder] = await db
      .select({ id: _decisions.id })
      .from(_decisions)
      .where(
        and(eq(_decisions.taskId, row.taskId), eq(_decisions.label, s.label)),
      );
    const labelFree = holder === undefined || holder.id === id;
    await db
      .update(_decisions)
      .set({
        ...(labelFree ? { label: s.label } : {}),
        state: s.state,
        stateLabel: s.stateLabel,
        question: s.question,
        body: s.body,
        options: s.options,
        outcome: s.outcome,
        closedAt: s.closedAt === null ? null : new Date(s.closedAt),
      })
      .where(eq(_decisions.id, id));
  },
});
