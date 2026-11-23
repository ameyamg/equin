/**
 * Real-Postgres suite for the harvest's writers: a record's ingest
 * (idempotent), and `recomputeFileStatus` deriving every status — never run,
 * passing, failing, flaky, stale — and dropping the rows of files the
 * checkout no longer has.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import {
  createTestDb,
  type TestDb,
} from "@plugins/database/plugins/db-test-fixture/server/testing";
import { runMigrations } from "@plugins/database/plugins/migrations/server/testing";
import type { TestRunRecord } from "@plugins/framework/plugins/cli/plugins/test/plugins/record/core";
import { ingestRunRecord } from "./ingest-record";
import { recomputeFileStatus } from "./recompute";
import {
  _testCaseFailures,
  _testCheckoutDigests,
  _testFileResults,
  _testFileStatus,
  _testRuns,
} from "./tables";

let t: TestDb;

/** The namespace whose runs are the checkout's own. */
const OWN = "main-ns";

beforeAll(async () => {
  t = await createTestDb({ prefix: "debug_tests_status" });
  await runMigrations(t.db);
});

afterAll(async () => {
  await t.drop();
});

const F = {
  pass: "a/pass.test.ts",
  fail: "a/fail.test.ts",
  flaky: "a/flaky.test.ts",
  stale: "a/stale.test.ts",
  never: "a/never.test.ts",
};

function record(
  opId: string,
  at: string,
  files: [path: string, digest: string, outcome: "passed" | "failed"][],
  slug = "wt",
): TestRunRecord {
  return {
    v: 1,
    opId,
    repo: "/repo",
    slug,
    origin: "agent",
    head: null,
    treeHash: "tree",
    startedAt: at,
    finishedAt: at,
    digestVersion: "test-digest-1",
    runners: [
      {
        runner: "bun:test",
        exitCode: 1,
        files: files.length,
        unattributed: false,
      },
    ],
    files: files.map(([path, digest, outcome]) => ({
      path,
      runner: "bun:test",
      digest,
      outcome,
      cases: 2,
      failedCases: outcome === "failed" ? 1 : 0,
      durationMs: 10,
    })),
    failures: files
      .filter(([, , o]) => o === "failed")
      .map(([path]) => ({
        path,
        caseId: "grp > case",
        message: "boom",
        detail: "stack",
      })),
  };
}

async function statuses(): Promise<Record<string, string>> {
  const rows = await t.db
    .select({ path: _testFileStatus.path, status: _testFileStatus.status })
    .from(_testFileStatus)
    .orderBy(asc(_testFileStatus.path));
  return Object.fromEntries(rows.map((r) => [r.path, r.status]));
}

describe("ingest + recomputeFileStatus", () => {
  test("every status from the results on each file's current digest", async () => {
    await t.db.insert(_testCheckoutDigests).values(
      Object.values(F).map((path) => ({
        path,
        digest: "cur",
        runner: "bun:test" as const,
        pluginId: "a",
        generation: "g1",
      })),
    );
    const r1 = record("op-1", "2026-11-11T10:00:00.000Z", [
      [F.pass, "cur", "passed"],
      [F.fail, "cur", "failed"],
      [F.flaky, "cur", "passed"],
      [F.stale, "old", "failed"],
    ]);
    const r2 = record("op-2", "2026-11-11T11:00:00.000Z", [
      [F.flaky, "cur", "failed"],
    ]);
    expect(await ingestRunRecord(t.db, r1, OWN)).toBe(true);
    expect(await ingestRunRecord(t.db, r2, OWN)).toBe(true);
    // A record not yet seen changes nothing when ingested again.
    expect(await ingestRunRecord(t.db, r1, OWN)).toBe(false);
    expect((await t.db.select().from(_testRuns)).length).toBe(2);
    expect((await t.db.select().from(_testFileResults)).length).toBe(5);
    expect((await t.db.select().from(_testCaseFailures)).length).toBe(3);

    await recomputeFileStatus(t.db, "all", OWN);
    expect(await statuses()).toEqual({
      [F.fail]: "failing",
      [F.flaky]: "flaky",
      [F.never]: "never",
      [F.pass]: "passing",
      [F.stale]: "stale",
    });
  });

  test("a file leaving the checkout loses its status row", async () => {
    await t.db.delete(_testCheckoutDigests);
    await t.db.insert(_testCheckoutDigests).values({
      path: F.pass,
      digest: "cur",
      runner: "bun:test",
      pluginId: "a",
      generation: "g2",
    });
    const { deleted } = await recomputeFileStatus(t.db, "all", OWN);
    expect(deleted).toBe(4);
    expect(await statuses()).toEqual({ [F.pass]: "passing" });
  });

  test("a scoped recompute drops a scoped path no longer in the checkout", async () => {
    await t.db.insert(_testFileStatus).values({
      path: F.fail,
      runner: "bun:test",
      digest: "cur",
      status: "failing",
      currentPassed: 0,
      currentFailed: 1,
      ownPassed: 0,
      ownFailed: 0,
      history: [],
    });
    await recomputeFileStatus(t.db, [F.fail, F.pass], OWN);
    expect(await statuses()).toEqual({ [F.pass]: "passing" });
  });

  test("the row's last result is about the code its status is (never a newer run of other code), and own runs are counted apart", async () => {
    const path = "b/mixed.test.ts";
    await t.db.insert(_testCheckoutDigests).values({
      path,
      digest: "main",
      runner: "bun:test",
      pluginId: "b",
      generation: "g3",
    });
    // Main failed it twice on its code; an agent then passed it on ITS
    // change (another digest) — newer, but about other code.
    await ingestRunRecord(
      t.db,
      record(
        "op-m1",
        "2026-11-12T10:00:00.000Z",
        [[path, "main", "failed"]],
        OWN,
      ),
      OWN,
    );
    await ingestRunRecord(
      t.db,
      record("op-w1", "2026-11-12T10:30:00.000Z", [[path, "main", "failed"]]),
      OWN,
    );
    await ingestRunRecord(
      t.db,
      record("op-w2", "2026-11-12T11:00:00.000Z", [[path, "branch", "passed"]]),
      OWN,
    );
    const [row] = await t.db
      .select()
      .from(_testFileStatus)
      .where(eq(_testFileStatus.path, path));
    expect(row).toMatchObject({
      status: "failing",
      lastOutcome: "failed",
      lastOpId: "op-w1",
      currentFailed: 2,
      ownFailed: 1,
      ownPassed: 0,
    });
  });
});
