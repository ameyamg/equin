/**
 * The dead-job ledger (`dead-job-ledger.ts`) against a throwaway Postgres
 * seeded with the REAL migration chain: a dead row the queue still holds is
 * reported once however many checks sample it — across a "restart" too, the
 * ledger being a table — while a new death (another row, or the same row
 * retried and dead again) is reported once more.
 *
 * Run: `./equin test plugins/debug/plugins/queue-health`
 * (requires the running embedded cluster — `./equin build` first).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  createTestDb,
  type TestDb,
} from "@plugins/database/plugins/db-test-fixture/server/testing";
import { runMigrations } from "@plugins/database/plugins/migrations/server/testing";
import type { DeadJobDeath } from "@plugins/infra/plugins/jobs/machine";
import type { DeadJobGroup } from "./dead-job-cause";
import { _queueDeadJobsReported } from "../../server/internal/tables";
import { reportNewDeaths, type DeadJobSource } from "./dead-job-ledger";

const death = (
  jobId: string,
  runAtUs: number,
  lastError: string,
  jobName = "desktop.fullscreen-budget",
): DeadJobDeath => ({
  deathId: `${jobId}@${runAtUs}`,
  jobId,
  jobName,
  lastError,
  attempts: 1,
  maxAttempts: 1,
});

const exited = (runId: string) =>
  `[supervised-job] desktop.fullscreen-budget: run ${runId} exited 1 on attempt 1/1: recorded no error`;

describe("dead-job ledger (real DB)", () => {
  let t: TestDb;
  let filed: DeadJobGroup[] = [];
  // The queue as the jobs plugin reads it: these deaths, newest first.
  const queue = (deaths: DeadJobDeath[]): DeadJobSource => ({
    ids: async () => deaths.map((d) => d.deathId),
    deaths: async (ids) => deaths.filter((d) => ids.includes(d.deathId)),
  });
  const check = (deaths: DeadJobDeath[]) =>
    reportNewDeaths(
      queue(deaths),
      async (g) => {
        filed.push(g);
        return true;
      },
      t.db,
    );

  beforeAll(async () => {
    t = await createTestDb({ prefix: "queue_dead_ledger_test" });
    await runMigrations(t.db);
  });
  afterAll(async () => {
    await t.drop();
  });

  // 2026-11-17: run 25ff3aa9 filed 10 occurrences in 45 min, one per check.
  test("a death the queue keeps holding is reported once, however many checks see it", async () => {
    filed = [];
    const a = death(
      "4037432",
      1,
      exited("25ff3aa9-de23-4618-8258-c4fd1b618ca5"),
    );
    for (let i = 0; i < 9; i++) await check([a]);
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({
      jobName: "desktop.fullscreen-budget",
      deadCount: 1,
      sampleJobId: "4037432",
    });
  });

  test("a new death of the same cause is one more occurrence, counting only the new one", async () => {
    filed = [];
    const a = death(
      "4037432",
      1,
      exited("25ff3aa9-de23-4618-8258-c4fd1b618ca5"),
    );
    const b = death(
      "4037500",
      2,
      exited("d1c3dfba-b27d-4d12-a6ce-ad6c9b8d2f69"),
    );
    const c = death(
      "4037501",
      3,
      exited("99223768-feda-4160-9a81-65a0429558f1"),
    );
    expect(await check([c, b, a])).toBe(2);
    expect(await check([c, b, a])).toBe(0);
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({ deadCount: 2, sampleJobId: "4037501" });
  });

  test("a new cause is its own occurrence, beside a death already reported", async () => {
    filed = [];
    const a = death(
      "4037432",
      1,
      exited("25ff3aa9-de23-4618-8258-c4fd1b618ca5"),
    );
    const other = death(
      "4037600",
      4,
      "[jobs] unknown job",
      "plugin-records.verify",
    );
    await check([other, a]);
    await check([other, a]);
    expect(filed.map((g) => g.jobName)).toEqual(["plugin-records.verify"]);
  });

  test("a row retried and dead again is a new death; a death the queue archived is forgotten", async () => {
    filed = [];
    // The GC archived every row but one; the retried row died again with a
    // new run_at.
    const retried = death(
      "4037432",
      10,
      exited("0bdff6ba-342b-4e81-9f2f-a01978cc5053"),
    );
    await check([retried]);
    await check([retried]);
    expect(filed).toHaveLength(1);
    expect(
      (await t.db.select().from(_queueDeadJobsReported)).map((r) => r.deathId),
    ).toEqual(["4037432@10"]);
    // An empty dead set empties the ledger.
    await check([]);
    expect(await t.db.select().from(_queueDeadJobsReported)).toHaveLength(0);
  });

  test("a report that fails leaves its deaths to the next check", async () => {
    filed = [];
    const d = death("4037700", 20, "boom", "worktree.spare-refill");
    expect(
      reportNewDeaths(
        queue([d]),
        () => Promise.reject(new Error("db down")),
        t.db,
      ),
    ).rejects.toThrow("db down");
    await check([d]);
    expect(filed).toHaveLength(1);
  });

  // The engine folds an occurrence past the kind's fan-out budget into a storm
  // rollup and writes no row for it: its deaths must still get one later.
  test("an occurrence the engine did not take (collapsed) is filed by a later check", async () => {
    filed = [];
    const d = death("4037800", 30, "storm", "worktree.prepare");
    expect(await reportNewDeaths(queue([d]), async () => false, t.db)).toBe(0);
    expect(await check([d])).toBe(1);
    expect(await check([d])).toBe(0);
    expect(filed).toHaveLength(1);
  });
});
