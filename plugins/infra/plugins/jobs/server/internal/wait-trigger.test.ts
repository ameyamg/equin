/**
 * A `ctx.waitFor`'s one-shot event trigger lives exactly as long as its wait:
 * however the wait ends, its trigger row is gone. Before, only a fired trigger
 * was deleted — a timed-out wait, or one the arm-time `settled` recheck
 * resolved, left its row for good (502 on main, 2026-11-25).
 *
 * Runs the real arming transaction (`armEventWait`), the real end writes
 * (`resolveWait` — the timeout racer's, `settleWait` — the recheck's,
 * `deleteWorkflowLog`) and the real `jobs.wait-trigger` DB trigger against a
 * throwaway database with the migration chain applied. The trigger rows go in
 * a real event trigger table; the hook writing them stands in for the events
 * plugin's (which imports jobs), on the transaction it is handed.
 *
 * Run: `./equin test plugins/infra/plugins/jobs`
 * (requires the running embedded cluster — `./equin build` first).
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  createTestDb,
  type TestDb,
} from "@plugins/database/plugins/db-test-fixture/server/testing";
import { installDbTriggers } from "@plugins/database/plugins/db-triggers/server";
import { runMigrations } from "@plugins/database/plugins/migrations/server/testing";
import type { EnqueueTx } from "./registry";
import { RESUME_KEYS, type ResumeInput } from "./resume-contract";
import { resolveWait } from "./resume-job";
import { armEventWait, type DurableHooks, settleWait } from "./step-ctx";
import { _jobWaits } from "./tables";
import { waitTriggerLifetime } from "./wait-trigger";
import { deleteWorkflowLog } from "./workflow-log";

// Any event's trigger table: they share one column set.
const TRIGGER_TABLE = "supervisedRun_ended_triggers";

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb({ prefix: "wait_trigger_test" });
  await runMigrations(t.db);
  await installDbTriggers(t.db, [waitTriggerLifetime]);
});

afterAll(async () => {
  await t.drop();
});

const registerTrigger: DurableHooks["registerTrigger"] = async (
  spec,
  exec: EnqueueTx,
) => {
  const rows = await exec.execute(
    sql`INSERT INTO ${sql.identifier(TRIGGER_TABLE)} (job_name, job_with, one_shot)
        VALUES ('jobs.resume', ${JSON.stringify(spec.with)}::jsonb, true)
        RETURNING id`,
  );
  return {
    table: TRIGGER_TABLE,
    id: z.object({ id: z.string() }).parse(rows.rows[0]).id,
  };
};

async function arm(runId: string): Promise<void> {
  const resume: ResumeInput = {
    [RESUME_KEYS.workflowRunId]: runId,
    [RESUME_KEYS.waitName]: "wait:x:0",
    [RESUME_KEYS.jobName]: "jobs.wait-trigger-test",
    [RESUME_KEYS.input]: {},
  };
  const armed = await armEventWait(t.db, registerTrigger, {
    workflowRunId: runId,
    waitName: "wait:x:0",
    wakerKey: `jobs.resume.timeout:${runId}:wait:x:0`,
    trigger: {
      event: { __kind: "event", def: { name: "x" }, filter: {} },
      with: resume,
      where: {},
    },
  });
  expect(armed).toBe(true);
}

async function triggersOf(runId: string): Promise<number> {
  const rows = await t.db.execute(
    sql`SELECT count(*)::int AS n FROM ${sql.identifier(TRIGGER_TABLE)}
        WHERE job_with->>${RESUME_KEYS.workflowRunId} = ${runId}`,
  );
  return z.object({ n: z.number() }).parse(rows.rows[0]).n;
}

async function waitOf(runId: string) {
  const [row] = await t.db
    .select()
    .from(_jobWaits)
    .where(
      and(
        eq(_jobWaits.workflowRunId, runId),
        eq(_jobWaits.waitName, "wait:x:0"),
      ),
    );
  return row;
}

test("arming records the wait and the trigger row it armed, together", async () => {
  await arm("run-armed");
  const wait = await waitOf("run-armed");
  expect(wait?.status).toBe("pending");
  expect(wait?.triggerTable).toBe(TRIGGER_TABLE);
  expect(wait?.triggerId).not.toBeNull();
  expect(await triggersOf("run-armed")).toBe(1);
});

test("a second arming of the same wait arms nothing", async () => {
  await arm("run-twice");
  const again = await armEventWait(t.db, registerTrigger, {
    workflowRunId: "run-twice",
    waitName: "wait:x:0",
    wakerKey: null,
    trigger: {
      event: { __kind: "event", def: { name: "x" }, filter: {} },
      with: {
        [RESUME_KEYS.workflowRunId]: "run-twice",
        [RESUME_KEYS.waitName]: "wait:x:0",
        [RESUME_KEYS.jobName]: "jobs.wait-trigger-test",
        [RESUME_KEYS.input]: {},
      },
      where: {},
    },
  });
  expect(again).toBe(false);
  expect(await triggersOf("run-twice")).toBe(1);
});

test("a timed-out wait leaves no trigger row", async () => {
  await arm("run-timeout");
  expect(await resolveWait(t.db, "run-timeout", "wait:x:0", true, {})).toBe(
    true,
  );
  expect((await waitOf("run-timeout"))?.status).toBe("timed_out");
  expect(await triggersOf("run-timeout")).toBe(0);
});

test("a wait the settled recheck resolved leaves no trigger row", async () => {
  await arm("run-recheck");
  expect(await settleWait(t.db, "run-recheck", "wait:x:0")).toBe(true);
  expect((await waitOf("run-recheck"))?.status).toBe("resolved");
  expect(await triggersOf("run-recheck")).toBe(0);
});

test("a run's log discarded while its wait is pending takes the trigger too", async () => {
  await arm("run-discarded");
  await deleteWorkflowLog(t.db, "run-discarded");
  expect(await waitOf("run-discarded")).toBeUndefined();
  expect(await triggersOf("run-discarded")).toBe(0);
});

test("a wait whose trigger table is gone still ends", async () => {
  await t.db.insert(_jobWaits).values({
    workflowRunId: "run-dropped-table",
    waitName: "wait:x:0",
    status: "pending",
    triggerTable: "no_such_event_triggers",
    triggerId: "00000000-0000-4000-8000-000000000000",
  });
  expect(
    await resolveWait(t.db, "run-dropped-table", "wait:x:0", true, {}),
  ).toBe(true);
});
