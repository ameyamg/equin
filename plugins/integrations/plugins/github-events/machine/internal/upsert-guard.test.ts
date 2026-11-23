/**
 * The ingest's upsert guard against a real Postgres (db-test-fixture, seeded
 * with the REAL migration chain): a catch-up re-listing a run or release
 * exactly as stored writes nothing — no new row version (`xmin` stays), so
 * the change feed's statement trigger sees no row and sends nothing — while a
 * newer or changed state is written and an older one is not.
 *
 * Run: `./equin test plugins/integrations/plugins/github-events`
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  createTestDb,
  type TestDb,
} from "@plugins/database/plugins/db-test-fixture/server/testing";
import { runMigrations } from "@plugins/database/plugins/migrations/server/testing";
import { _githubReleases, _githubRuns } from "../../server";
import { newerAndDifferent } from "./upsert-guard";

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb({ prefix: "gh_upsert_guard" });
  await runMigrations(t.db);
});

afterAll(async () => {
  await t.drop();
});

const RUN = {
  id: "o/r#1#1",
  repo: "o/r",
  runId: "1",
  attempt: 1,
  workflowPath: ".github/workflows/release.yml",
  workflowName: "Release",
  event: "push",
  head: "v2026.11.23",
  headSha: "abc",
  status: "completed",
  conclusion: "success",
  url: "https://github.com/o/r/actions/runs/1",
  githubUpdatedAt: new Date("2026-11-23T01:00:00Z"),
  startedAt: new Date("2026-11-23T00:50:00Z"),
  finishedAt: new Date("2026-11-23T01:00:00Z"),
};

async function upsertRun(facts: typeof RUN): Promise<void> {
  const { id: _id, ...set } = facts;
  await t.db
    .insert(_githubRuns)
    .values({ ...facts, failedJobs: [], reportedAt: null })
    .onConflictDoUpdate({
      target: _githubRuns.id,
      set,
      setWhere: newerAndDifferent(_githubRuns, set),
    });
}

async function runVersion(): Promise<{ xmin: string; status: string }> {
  const [row] = await t.db
    .select({ xmin: sql<string>`xmin::text`, status: _githubRuns.status })
    .from(_githubRuns)
    .where(eq(_githubRuns.id, RUN.id));
  if (row === undefined) throw new Error("run not stored");
  return row;
}

describe("github_runs upsert", () => {
  test("an identical re-listing writes no new row version", async () => {
    await upsertRun(RUN);
    const first = await runVersion();
    await upsertRun(RUN);
    await upsertRun({ ...RUN });
    expect(await runVersion()).toEqual(first);
  });

  test("a changed state at the same update time is written", async () => {
    const before = await runVersion();
    await upsertRun({ ...RUN, conclusion: "failure" });
    const after = await runVersion();
    expect(after.xmin).not.toBe(before.xmin);
    await upsertRun(RUN); // back, for the next case
  });

  test("a newer state is written, an older one is not", async () => {
    await upsertRun({
      ...RUN,
      status: "in_progress",
      githubUpdatedAt: new Date("2026-11-23T02:00:00Z"),
    });
    expect((await runVersion()).status).toBe("in_progress");
    const newest = await runVersion();
    await upsertRun({ ...RUN, status: "queued" }); // 01:00, older
    expect(await runVersion()).toEqual(newest);
  });
});

describe("github_releases upsert", () => {
  const RELEASE = {
    id: "o/r#v2026.11.23",
    repo: "o/r",
    tag: "v2026.11.23",
    draft: false,
    assets: ["a.tar.gz", "b.tar.gz"],
    url: "https://github.com/o/r/releases/tag/v2026.11.23",
    githubUpdatedAt: new Date("2026-11-23T01:00:00Z"),
  };

  async function upsertRelease(r: typeof RELEASE): Promise<void> {
    const { id: _id, ...set } = r;
    await t.db
      .insert(_githubReleases)
      .values(r)
      .onConflictDoUpdate({
        target: _githubReleases.id,
        set,
        setWhere: newerAndDifferent(_githubReleases, set),
      });
  }

  async function releaseXmin(): Promise<string> {
    const [row] = await t.db
      .select({ xmin: sql<string>`xmin::text` })
      .from(_githubReleases)
      .where(eq(_githubReleases.id, RELEASE.id));
    if (row === undefined) throw new Error("release not stored");
    return row.xmin;
  }

  test("an identical re-listing writes nothing; a new asset is written", async () => {
    await upsertRelease(RELEASE);
    const first = await releaseXmin();
    await upsertRelease({ ...RELEASE, assets: [...RELEASE.assets] });
    expect(await releaseXmin()).toBe(first);
    await upsertRelease({
      ...RELEASE,
      assets: [...RELEASE.assets, "c.tar.gz"],
    });
    expect(await releaseXmin()).not.toBe(first);
  });
});
