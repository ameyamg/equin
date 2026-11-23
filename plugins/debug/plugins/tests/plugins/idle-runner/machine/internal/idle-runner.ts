import { z } from "zod";
import { db } from "@plugins/database/server";
import { CLI_NAME } from "@plugins/framework/plugins/cli/plugins/cli-name/core";
import { TESTS_FAILED_EXIT } from "@plugins/framework/plugins/cli/plugins/test/plugins/record/core";
import { REPO_ROOT } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
import { envEntries } from "@plugins/infra/plugins/launcher/plugins/env-names/core";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import {
  cancelSupervisedJobByLock,
  defineSupervisedJob,
  latestSupervisedRun,
} from "@plugins/infra/plugins/jobs/plugins/supervised-job/server";
import { defineLogSink } from "@plugins/primitives/plugins/log-channels/server";
import { readHostIdleRecord } from "@plugins/infra/plugins/host/plugins/idle/server";
import { isMain } from "@plugins/infra/plugins/runtime-identity/core";
import { defineRefReaction } from "@plugins/infra/plugins/git/plugins/git-watcher/server";
import { _testFileStatus } from "@plugins/debug/plugins/tests/server";
import {
  ingestRunRecordsNow,
  requestCheckoutDigests,
} from "@plugins/debug/plugins/tests/machine";
import { fileTestFailingReports } from "@plugins/debug/plugins/tests/plugins/failing-report/machine";
import { selectIdleBatch, type BatchPool } from "./select-batch";

// The test runner of a checkout: runs the files whose verdict on the current
// code it still owes, one small batch after another.
//
// On MAIN its verdicts follow main's head: the due files (to confirm, seen
// failing elsewhere, stale, never run — `duePool`) run whenever the host lets
// an opportunistic op run, idle or not. Everywhere else, and for main's
// 7-day re-verify sweep, only while the host is idle (infra/host/idle — no
// agent working, no op running, no duress, for 10 min).
//
//   main boot / advance  → digests brought to the new tree (debug/tests)
//   tests.digestsSettled → next batch
//   tests.runsIngested   → next batch (a failure seen elsewhere is due)
//   a batch ended        → ingest its record, judge it, then the next batch
//   main advanced        → cancel the running batch (its tree moved: its
//                          harvest would be skipped)
//   host.idleBegan       → digests current, then the next batch
//   host.idleEnded       → cancel a running SWEEP batch
//
// Each batch is an ordinary `./equin test`, OPPORTUNISTIC
// (`EQUIN_OP_OPPORTUNISTIC`: background lane, low priority, not counted as
// work by the ops blocker — or it would end the idle period it runs in) and
// marked `idle` in its harvest record.

const idleRunLog = defineLogSink({
  id: "tests-idle-runs",
  description:
    "Test-status page: the `./equin test` batches this checkout's test runner ran (main: whenever a verdict is owed; elsewhere while the computer is idle).",
});

/** Each pool's batches hold their own lock; at most one batch runs at all. */
const POOLS: readonly BatchPool[] = ["due", "sweep"];

// How many batches of this process took each (file, digest). A file a run
// cannot give a verdict (its record skipped: the tree moved mid-run; a wedged
// runner) keeps its status and would be picked again and again — so it is
// taken at most twice on the same code. Process memory: a restart (every push
// on main) starts over, which re-tries such a file at most twice per push.
const taken = new Map<string, number>();
const TAKES_PER_DIGEST = 2;
const takeKey = (path: string, digest: string) => `${path}\0${digest}`;

export const idleBatchJob = defineSupervisedJob({
  name: "tests.idle-batch",
  description:
    "Runs a small batch of test files whose verdict on the current code is owed (on main whenever it is owed, elsewhere while the computer is idle), so Debug → Tests and main's test reports follow the code without costing anyone time.",
  input: z.object({
    paths: z.array(z.string()).min(1),
    pool: z.enum(["due", "sweep"]),
  }),
  channel: idleRunLog,
  runAttempts: 1,
  // Failing tests are the page's data (the run's record), never a failed job.
  verdictExits: [TESTS_FAILED_EXIT],
  lock: (input) => input.pool,
  argv: (input) => ({
    argv: [`./${CLI_NAME}`, "test", ...input.paths],
    cwd: REPO_ROOT,
    envOverrides: envEntries({ OP_OPPORTUNISTIC: "1", TEST_ORIGIN: "idle" }),
  }),
  onEnded: async (_runId, _terminal, meta) => {
    // Cancelled: the host stopped being idle, or main moved — what follows
    // is decided by whoever cancelled it.
    if (meta.cancelled) return;
    // Its verdicts must be in the statuses the next selection reads.
    await ingestRunRecordsNow();
    try {
      // A file of main that went from passing to failing (confirmed) is
      // filed; one that failed once is due again (derived from its status).
      await fileTestFailingReports(meta.input.paths);
    } finally {
      // A filing error stays loud, but never stops the chain.
      await idleNextJob.enqueue({});
    }
  },
});

async function batchRunning(): Promise<boolean> {
  for (const pool of POOLS)
    if (
      (await latestSupervisedRun(idleBatchJob, { paths: [pool], pool }))?.open
    )
      return true;
  return false;
}

/** Start the next batch — when one is owed (main) or the host is idle, and none runs. */
export async function startNextIdleBatch(
  now: number = Date.now(),
): Promise<void> {
  const idle = (await readHostIdleRecord())?.state === "idle";
  // Only main owes verdicts whatever the host is doing; a worktree's runner
  // fills its page in only while nothing else wants the machine.
  if (!idle && !isMain()) return;
  if (await batchRunning()) return;
  const rows = await db
    .select({
      path: _testFileStatus.path,
      digest: _testFileStatus.digest,
      status: _testFileStatus.status,
      lastOutcome: _testFileStatus.lastOutcome,
      lastRanAt: _testFileStatus.lastRanAt,
      durationMs: _testFileStatus.durationMs,
      currentPassed: _testFileStatus.currentPassed,
      currentFailed: _testFileStatus.currentFailed,
      ownPassed: _testFileStatus.ownPassed,
      ownFailed: _testFileStatus.ownFailed,
    })
    .from(_testFileStatus);
  const batch = selectIdleBatch(
    rows.filter(
      (r) => (taken.get(takeKey(r.path, r.digest)) ?? 0) < TAKES_PER_DIGEST,
    ),
    now,
    { idle },
  );
  if (batch === null) return;
  const digestOf = new Map(rows.map((r) => [r.path, r.digest]));
  for (const p of batch.paths) {
    const key = takeKey(p, digestOf.get(p)!);
    taken.set(key, (taken.get(key) ?? 0) + 1);
  }
  await idleBatchJob.enqueue(batch);
}

/** Cancel the running batch of each of `pools`. */
async function cancelBatches(pools: readonly BatchPool[]): Promise<void> {
  for (const pool of pools)
    await cancelSupervisedJobByLock(idleBatchJob, { paths: [pool], pool });
}

export const idleNextJob = defineJob({
  name: "tests.idle-next",
  description:
    "Picks the next test files to run — the ones whose verdict on the current code is owed (to confirm, seen failing elsewhere, stale, never run), and while the computer is idle the oldest verdicts — and starts them.",
  hold: "seconds",
  input: z.object({}),
  event: z.unknown(),
  // One pending pick; never two at once (each would start a batch).
  dedup: "singleton",
  serial: true,
  run: async () => {
    await startNextIdleBatch();
  },
});

export const idleBeganJob = defineJob({
  name: "tests.idle-began",
  description:
    "When the computer becomes idle, brings the test digests up to date with the current code, so the idle test runs pick files by their real status.",
  hold: "seconds",
  input: z.object({}),
  event: z.unknown(),
  dedup: "singleton",
  run: async () => {
    // Its end (tests.digestsSettled) starts the first batch.
    await requestCheckoutDigests();
  },
});

export const idleEndedJob = defineJob({
  name: "tests.idle-ended",
  description:
    "When the computer stops being idle, stops the idle-only (sweep) test run in progress so it never competes with real work; a batch of owed verdicts on main keeps running at low priority.",
  hold: "seconds",
  input: z.object({}),
  event: z.unknown(),
  dedup: "singleton",
  run: async () => {
    await cancelBatches(isMain() ? ["sweep"] : POOLS);
  },
});

/**
 * Main moved: a batch running now tests a tree that is going away (its
 * harvest is skipped once the checkout changes under it), so it is cancelled;
 * the new digests' settling starts the next one, on the new code.
 */
export const batchOnMainAdvance = defineRefReaction({
  name: "tests.idle-batch",
  refName: "refs/heads/main",
  run: async () => {
    if (isMain()) await cancelBatches(POOLS);
  },
});
