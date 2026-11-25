import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@plugins/database/server";
import type { TaskId } from "@plugins/tasks/plugins/task-ids/core";
import { executeRows } from "@plugins/database/plugins/sql-rows/core";
import { _decisionExchanges, _decisions } from "./tables";

// What an agent still owes on its decisions, and what it waits on the user
// for — read by the stop gate (it may not stop while it owes a reply or an
// action on an answer it was sent) and by the exit_clean precondition (it may
// not finish cleanly while a decision of its still needs the user, either).

/** The most labels one refusal names. */
const NAMED = 10;

const Owed = z.object({
  label: z.string(),
  owes: z.enum(["reply", "act"]),
});

/**
 * The task's decisions whose agent owes something: a question the user sent
 * that it has not replied to (`reply`), or an answer it has not acted on
 * (`act` — any update_decision on it consumes it).
 */
export async function owedDecisions(
  exec: DbExecutor,
  taskId: TaskId,
): Promise<z.infer<typeof Owed>[]> {
  const d = _decisions;
  const x = _decisionExchanges;
  return executeRows(exec, {
    label: "decisions.owed",
    row: Owed,
    query: sql`
      SELECT DISTINCT ON (${d.id}) ${d.label} AS label,
             CASE WHEN ${x.kind} = 'question' THEN 'reply' ELSE 'act' END AS owes
        FROM ${d} JOIN ${x} ON ${x.decisionId} = ${d.id}
       WHERE ${d.taskId} = ${taskId}
         AND ((${x.kind} = 'question' AND ${x.agentText} IS NULL)
           OR (${x.kind} = 'answer' AND ${x.consumedAt} IS NULL))
       ORDER BY ${d.id}, ${d.openedAt}
       LIMIT ${NAMED + 1}`,
  });
}

/**
 * The task's open decisions that wait on the user: `decision` / `action`
 * with no answer the agent has not acted on (FYI and `other` do not: nothing
 * is asked of the user there).
 */
export async function decisionsAwaitingUser(
  exec: DbExecutor,
  taskId: TaskId,
): Promise<string[]> {
  const pending = exec
    .select({ id: _decisionExchanges.decisionId })
    .from(_decisionExchanges)
    .where(
      and(
        eq(_decisionExchanges.kind, "answer"),
        isNull(_decisionExchanges.consumedAt),
      ),
    );
  const rows = await exec
    .select({ label: _decisions.label })
    .from(_decisions)
    .where(
      and(
        eq(_decisions.taskId, taskId),
        inArray(_decisions.state, ["decision", "action"]),
        sql`${_decisions.id} NOT IN ${pending}`,
      ),
    )
    .orderBy(_decisions.openedAt)
    .limit(NAMED + 1);
  return rows.map((r) => r.label);
}

const named = (labels: readonly string[]): string =>
  labels.length > NAMED
    ? `${labels.slice(0, NAMED).join(", ")} and more`
    : labels.join(", ");

/** What the agent is told while it owes replies or actions: `null` when it owes nothing. */
export function owedMessage(
  owed: readonly z.infer<typeof Owed>[],
): string | null {
  if (owed.length === 0) return null;
  const reply = owed.filter((o) => o.owes === "reply").map((o) => o.label);
  const act = owed.filter((o) => o.owes === "act").map((o) => o.label);
  const parts: string[] = [];
  if (reply.length > 0)
    parts.push(
      `the user asked about ${named(reply)} and is waiting for your reply — answer with update_decision({ decision, reply })`,
    );
  if (act.length > 0)
    parts.push(
      `the user answered ${named(act)} and you have not acted on it — act on the answer, then close it (update_decision({ decision, state: "closed", outcome })) or update it`,
    );
  return `Your decisions are not settled: ${parts.join("; ")}.`;
}
