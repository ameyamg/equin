import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, type DbExecutor } from "@plugins/database/server";
import { _tasks } from "@plugins/tasks/plugins/tasks-core/server";
import type { TaskId } from "@plugins/tasks/plugins/task-ids/core";
import {
  DECISION_TABS,
  type DecisionId,
  type DecisionOption,
  type DecisionState,
  type DecisionTab,
} from "../../core";
import { decisionTabSql } from "./facts";
import { _decisionExchangeFacts } from "./rollup-table";
import { _decisionExchanges, _decisions } from "./tables";

/** One exchange of a decision's thread, as a reader of the record sees it. */
export interface FullExchange {
  kind: "answer" | "question" | "update" | "recorded";
  pick: string | null;
  userText: string | null;
  agentText: string | null;
  createdAt: Date;
  agentAt: Date | null;
}

/** One decision in full: what it says, where it stands, its whole thread. */
export interface FullDecision {
  id: string;
  label: string;
  state: DecisionState;
  stateLabel: string | null;
  tab: DecisionTab;
  question: string;
  body: string;
  options: readonly DecisionOption[];
  fromDecisionId: string | null;
  outcome: string | null;
  openedAt: Date;
  closedAt: Date | null;
  exchanges: FullExchange[];
}

/** A task's decisions in full, or that the task is gone. */
export type TaskDecisionsRead =
  | { exists: true; title: string; decisions: FullDecision[] }
  | { exists: false };

const tabs = new Set<string>(DECISION_TABS);

/** A decision in full, with the task it belongs to. */
type DecisionRow = FullDecision & { taskId: string };

/**
 * The decisions `where` selects, in full, opened first first, each with its
 * thread oldest first — the one read both entry points below share.
 */
async function readDecisionsWhere(
  exec: DbExecutor,
  where: SQL,
): Promise<DecisionRow[]> {
  const d = _decisions;
  const f = _decisionExchangeFacts;
  const decisions = await exec
    .select({
      id: d.id,
      taskId: d.taskId,
      label: d.label,
      state: d.state,
      stateLabel: d.stateLabel,
      tab: decisionTabSql(
        sql`${d.state}`,
        sql`COALESCE(${f.unconsumedAnswers}, 0)`,
      ).mapWith(String),
      question: d.question,
      body: d.body,
      options: d.options,
      fromDecisionId: d.fromDecisionId,
      outcome: d.outcome,
      openedAt: d.openedAt,
      closedAt: d.closedAt,
    })
    .from(d)
    .leftJoin(f, eq(f.decisionId, d.id))
    .where(where)
    .orderBy(asc(d.openedAt), asc(d.id));
  const x = _decisionExchanges;
  const exchanges =
    decisions.length === 0
      ? []
      : await exec
          .select({
            decisionId: x.decisionId,
            kind: x.kind,
            pick: x.pick,
            userText: x.userText,
            agentText: x.agentText,
            createdAt: x.createdAt,
            agentAt: x.agentAt,
          })
          .from(x)
          .where(
            inArray(
              x.decisionId,
              decisions.map((r) => r.id),
            ),
          )
          .orderBy(asc(x.createdAt), asc(x.id));
  const threadOf = new Map<string, FullExchange[]>();
  for (const e of exchanges) {
    const thread = threadOf.get(e.decisionId) ?? [];
    thread.push({
      kind: e.kind,
      pick: e.pick,
      userText: e.userText,
      agentText: e.agentText,
      createdAt: e.createdAt,
      agentAt: e.agentAt,
    });
    threadOf.set(e.decisionId, thread);
  }
  return decisions.map((r) => {
    if (!tabs.has(r.tab))
      throw new Error(`decision ${r.id}: derived tab ${r.tab} is not a tab`);
    return {
      id: r.id,
      taskId: r.taskId,
      label: r.label,
      state: r.state,
      stateLabel: r.stateLabel,
      tab: r.tab as DecisionTab,
      question: r.question,
      body: r.body,
      options: r.options,
      fromDecisionId: r.fromDecisionId,
      outcome: r.outcome,
      openedAt: r.openedAt,
      closedAt: r.closedAt,
      exchanges: threadOf.get(r.id) ?? [],
    };
  });
}

/**
 * Every decision of each of `taskIds` in full, opened first first, with its
 * thread oldest first. A task id naming no task answers `{ exists: false }`.
 * Bounded by the record's caps: DECISIONS_PER_TASK_MAX decisions per task,
 * EXCHANGES_PER_DECISION_MAX exchanges per decision — a reader handing this
 * to an agent bounds what it renders itself (the page block's projection).
 */
export async function readTaskDecisionsInFull(
  taskIds: readonly TaskId[],
  exec: DbExecutor = db,
): Promise<ReadonlyMap<TaskId, TaskDecisionsRead>> {
  const out = new Map<TaskId, TaskDecisionsRead>();
  if (taskIds.length === 0) return out;
  const ids = [...new Set(taskIds)];
  const tasks = await exec
    .select({ id: _tasks.id, title: _tasks.title })
    .from(_tasks)
    .where(inArray(_tasks.id, ids));
  const decisions = await readDecisionsWhere(
    exec,
    inArray(_decisions.taskId, ids),
  );
  for (const t of tasks)
    out.set(t.id as TaskId, { exists: true, title: t.title, decisions: [] });
  for (const { taskId, ...decision } of decisions) {
    const read = out.get(taskId as TaskId);
    // The FK cascades a task's decisions with it, so a decision's task is read.
    if (read === undefined || !read.exists)
      throw new Error(
        `decision ${decision.id}: its task ${taskId} was not read`,
      );
    read.decisions.push(decision);
  }
  for (const id of ids) if (!out.has(id)) out.set(id, { exists: false });
  return out;
}

/** One decision in full (any task's), with its task's id; null for no such id. */
export async function readDecisionInFull(
  decisionId: DecisionId,
  exec: DbExecutor = db,
): Promise<DecisionRow | null> {
  const [row] = await readDecisionsWhere(exec, eq(_decisions.id, decisionId));
  return row ?? null;
}

/** Which of `taskIds` name a task that exists. */
export async function existingTaskIds(
  taskIds: readonly string[],
  exec: DbExecutor = db,
): Promise<ReadonlySet<string>> {
  if (taskIds.length === 0) return new Set();
  const rows = await exec
    .select({ id: _tasks.id })
    .from(_tasks)
    .where(inArray(_tasks.id, [...new Set(taskIds)]));
  return new Set(rows.map((r) => r.id));
}
