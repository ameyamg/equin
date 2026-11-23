import { z } from "zod";
import { and, eq, gt, inArray, isNull, notExists, or, sql } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { runtimeNamespace } from "@plugins/infra/plugins/runtime-identity/core";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { RESULTS_KEPT_PER_FILE } from "../../core";
import { chunked, type DbExec } from "./db-exec";
import { recomputeFileStatus } from "./recompute";
import {
  _testCaseFailures,
  _testCheckoutDigests,
  _testFileResults,
} from "./tables";

const CHUNK = 500;

/**
 * Keep the newest {@link RESULTS_KEPT_PER_FILE} results per test file (their
 * failing cases with them), then re-derive those files' status. A cap, not a
 * TTL: a file nobody touched for months keeps its only verdicts.
 *
 * The results on the file's CURRENT digest are kept apart (up to the same
 * count): the backend ingests every checkout's runs, so agents' runs of their
 * own edits of a file would otherwise push out its verdict on this
 * checkout's code — the file would read `stale` and main's test runner would
 * re-run code that never changed.
 */
export async function capResults(
  exec: DbExec = db,
  slug: string = runtimeNamespace(),
): Promise<{ deleted: number }> {
  const ranked = exec.$with("ranked").as(
    exec
      .select({
        id: _testFileResults.id,
        opId: _testFileResults.opId,
        path: _testFileResults.path,
        rn: sql`row_number() OVER (PARTITION BY ${_testFileResults.path} ORDER BY ${_testFileResults.finishedAt} DESC, ${_testFileResults.opId} DESC)`
          .mapWith(Number)
          .as("rn"),
        // Rank among the results on the file's current digest; null for any
        // other digest.
        rnCurrent:
          sql`CASE WHEN ${_testFileResults.digest} = ${_testCheckoutDigests.digest} THEN row_number() OVER (PARTITION BY ${_testFileResults.path}, ${_testFileResults.digest} ORDER BY ${_testFileResults.finishedAt} DESC, ${_testFileResults.opId} DESC) END`
            .mapWith(Number)
            .as("rn_current"),
      })
      .from(_testFileResults)
      .leftJoin(
        _testCheckoutDigests,
        eq(_testCheckoutDigests.path, _testFileResults.path),
      ),
  );
  const over = await exec
    .with(ranked)
    .select({ id: ranked.id, opId: ranked.opId, path: ranked.path })
    .from(ranked)
    .where(
      and(
        gt(ranked.rn, RESULTS_KEPT_PER_FILE),
        or(
          isNull(ranked.rnCurrent),
          gt(ranked.rnCurrent, RESULTS_KEPT_PER_FILE),
        ),
      ),
    );
  for (const c of chunked(over, CHUNK))
    await exec.delete(_testFileResults).where(
      inArray(
        _testFileResults.id,
        c.map((r) => r.id),
      ),
    );
  // A failing case outlives no result of its file in its run.
  if (over.length > 0)
    await exec.delete(_testCaseFailures).where(
      notExists(
        exec
          .select({ one: sql`1` })
          .from(_testFileResults)
          .where(
            and(
              eq(_testFileResults.opId, _testCaseFailures.opId),
              eq(_testFileResults.path, _testCaseFailures.path),
            ),
          ),
      ),
    );
  await recomputeFileStatus(exec, [...new Set(over.map((r) => r.path))], slug);
  return { deleted: over.length };
}

export const resultsCapJob = defineJob({
  name: "tests.results-cap",
  description:
    "Keeps the newest 32 harvested results of each test file (and their failing cases) so the test-status tables stay bounded without forgetting a stable file's last verdict.",
  hold: "instant",
  input: z.object({}),
  event: z.never(),
  dedup: "singleton",
  schedule: { cron: "50 4 * * *" }, // daily at 04:50 UTC
  async run() {
    await capResults();
  },
});
