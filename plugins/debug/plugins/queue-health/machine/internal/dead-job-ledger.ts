import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "@plugins/database/server";
import type { DeadJobDeath } from "@plugins/infra/plugins/jobs/machine";
import { _queueDeadJobsReported } from "../../server/internal/tables";
import {
  deadJobCause,
  foldDeadJobsByCause,
  type DeadJobGroup,
} from "./dead-job-cause";

// One dead job is one fact, reported once. The queue keeps a dead row until the
// dead-job GC archives it (hourly, and at boot), and the watchdog samples it
// every five minutes, so the same death is in every sample: it used to file a
// `queue-dead-job` occurrence on every one of them (2026-11-17:
// `desktop.fullscreen-budget` run 25ff3aa9, 10 occurrences in 45 min; run
// d1c3dfba, 4 in 15 min). A new occurrence now comes only from a new death —
// another row, or a row retried and dead again. The ledger is
// `queue_dead_jobs_reported`, so a restart does not file the queue's dead rows
// again either.

/** Where a check reads the queue's dead rows (the jobs plugin's introspection). */
export interface DeadJobSource {
  /** Every death the queue holds, by id. */
  ids(): Promise<string[]>;
  /** The deaths named, with their errors, newest first. */
  deaths(deathIds: readonly string[]): Promise<DeadJobDeath[]>;
}

/**
 * File the deaths the queue holds that were not reported yet: one `file` call
 * per (jobName, cause) of the NEW deaths, its `deadCount` how many of them.
 * `file` answers whether the occurrence was taken: a cause's deaths are marked
 * reported only then, so a `file` that throws — or whose occurrence the engine
 * could not take yet (folded into a fan-out storm, `collapsed`) — leaves them
 * to the next check: late, never lost. Answers how many deaths were filed.
 */
export async function reportNewDeaths(
  source: DeadJobSource,
  file: (group: DeadJobGroup) => Promise<boolean>,
  conn: NodePgDatabase = db,
): Promise<number> {
  const fresh = await source.deaths(
    await unreportedDeathIds(await source.ids(), conn),
  );
  let filed = 0;
  for (const group of foldDeadJobsByCause(fresh.map(deathGroup))) {
    if (!(await file(group))) continue;
    const cause = deadJobCause(group.lastError);
    const members = fresh.filter(
      (d) => d.jobName === group.jobName && deadJobCause(d.lastError) === cause,
    );
    await markDeathsReported(members, conn);
    filed += members.length;
  }
  return filed;
}

/**
 * The ids in `ids` (the queue's dead rows right now) not reported yet, after
 * forgetting every reported death the queue no longer holds — so the ledger
 * stays the size of the dead set. One array parameter, however many ids.
 */
async function unreportedDeathIds(
  ids: readonly string[],
  conn: NodePgDatabase,
): Promise<string[]> {
  const held = sql.param([...ids]);
  await conn
    .delete(_queueDeadJobsReported)
    .where(sql`NOT (${_queueDeadJobsReported.deathId} = ANY(${held}::text[]))`);
  if (ids.length === 0) return [];
  const seen = new Set(
    (
      await conn
        .select({ deathId: _queueDeadJobsReported.deathId })
        .from(_queueDeadJobsReported)
        .where(sql`${_queueDeadJobsReported.deathId} = ANY(${held}::text[])`)
    ).map((r) => r.deathId),
  );
  return ids.filter((id) => !seen.has(id));
}

/** Record `deaths` as reported (idempotent). */
async function markDeathsReported(
  deaths: readonly DeadJobDeath[],
  conn: NodePgDatabase,
): Promise<void> {
  if (deaths.length === 0) return;
  await conn
    .insert(_queueDeadJobsReported)
    .values(deaths.map((d) => ({ deathId: d.deathId })))
    .onConflictDoNothing();
}

/** One death as a group of one, for `foldDeadJobsByCause`. */
function deathGroup(d: DeadJobDeath): DeadJobGroup {
  return {
    jobName: d.jobName,
    lastError: d.lastError,
    deadCount: 1,
    attempts: d.attempts,
    maxAttempts: d.maxAttempts,
    sampleJobId: d.jobId,
  };
}
