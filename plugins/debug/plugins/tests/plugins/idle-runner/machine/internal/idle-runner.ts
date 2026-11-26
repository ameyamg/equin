import { z } from "zod";
import { db } from "@plugins/database/server";
import { getConfig, watchConfig } from "@plugins/config_v2/server";
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
import { isMain } from "@plugins/infra/plugins/runtime-identity/core";
import { defineRefReaction } from "@plugins/infra/plugins/git/plugins/git-watcher/server";
import { defineWarmup } from "@plugins/infra/plugins/warmup/server";
import { runGit } from "@plugins/primitives/plugins/commit-list/server";
import { _testFileStatus } from "@plugins/debug/plugins/tests/server";
import { testRunnerConfig } from "@plugins/debug/plugins/tests/core";
import {
  ingestRunRecordsNow,
  requestCheckoutDigests,
} from "@plugins/debug/plugins/tests/machine";
import { fileTestFailingReports } from "@plugins/debug/plugins/tests/plugins/failing-report/machine";
import { selectDueBatch } from "./select-batch";

// MAIN's test runner: after each push, runs the test files whose verdict on
// main's current code is owed, one small batch after another, and files a
// `test-failing` report for each file a second run confirms broken.
//
// OFF unless the install turns it on (`testRunnerConfig`, Settings → Config):
// it spends the host's CPU after every push. MAIN only: a worktree's backend
// ingests every checkout's runs and its status rows are a fork of main's, so
// what it would owe is mostly main's own unchanged code; an agent's own
// changes are tested by its `./equin test` runs and the push gate.
//
// Every run is owed by a change, never by time (no periodic re-check):
//   main boot / advance  → digests brought to the new tree (debug/tests)
//   tests.digestsSettled → next batch (the files the change affected)
//   tests.runsIngested   → next batch (a failure another checkout saw on
//                          main's code: verified here once)
//   a batch ended        → ingest its record, judge it, then the next batch
//                          (one failure is confirmed by ONE more run)
//   main advanced        → cancel the running batch (its tree moved: its
//                          harvest would be skipped); no batch starts again
//                          in this backend, whose checkout is no longer main
//   main's backend boots → cancel a batch a previous backend left running
//                          (it tests the tree that backend served)
//
// Each batch is an ordinary `./equin test`, OPPORTUNISTIC
// (`EQUIN_OP_OPPORTUNISTIC`: background lane, low priority, not counted as
// work by the ops blocker) and marked `idle` in its harvest record (the
// origin's persisted name: the runner once ran only while the host was idle).

const runnerLog = defineLogSink({
  id: "tests-idle-runs",
  description:
    "Test-status page: the `./equin test` batches main's test runner ran after each push (when it is turned on).",
});

/** The one lock every batch holds: at most one batch runs at all. */
const BATCH_LOCK = "due";

/** Whether this backend runs the runner: main, with the runner turned on. */
function runnerOn(): boolean {
  return isMain() && getConfig(testRunnerConfig).enabled;
}

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
    "Runs a small batch of main's test files whose verdict on main's current code is owed (a push changed them, or a failure awaits its one confirming run), at low priority, when main's test runner is turned on.",
  input: z.object({
    paths: z.array(z.string()).min(1),
    // Persisted in run inputs: the old `sweep` pool is gone, `due` stays.
    pool: z.literal(BATCH_LOCK),
  }),
  channel: runnerLog,
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
    // Cancelled: main moved, or the runner was turned off — what follows is
    // decided by whoever cancelled it.
    if (meta.cancelled) return;
    // Its verdicts must be in the statuses the next selection reads.
    await ingestRunRecordsNow();
    try {
      // A file of main confirmed failing is filed; one that failed once is
      // due again (derived from its status) for its one confirming run.
      await fileTestFailingReports(meta.input.paths);
    } finally {
      // A filing error stays loud, but never stops the chain.
      await idleNextJob.enqueue({});
    }
  },
});

async function batchRunning(): Promise<boolean> {
  return (
    (
      await latestSupervisedRun(idleBatchJob, {
        paths: [BATCH_LOCK],
        pool: BATCH_LOCK,
      })
    )?.open ?? false
  );
}

/**
 * Whether the checkout a batch runs in (this backend's, `REPO_ROOT`: on main,
 * the slot it was built in, detached at its commit) is main's current code.
 *
 * Main advances minutes before its new backend takes over. In between, this
 * backend still runs, its checkout still the commit main just left: a batch
 * started then tests code main no longer is (its verdicts are owed nobody),
 * and — a detached child holding this slot — keeps running past the switch
 * beside the new backend's boot, holding the old slot draining (45–103 s,
 * report-1795461922-nsi1e3). So the runner tests main's code only: from the
 * advance to the new backend's boot it starts nothing. (A main whose build
 * fails keeps serving the old code: the runner waits for the next deploy.)
 */
async function checkoutIsMainTip(): Promise<boolean> {
  const [head, main] = (
    await runGit(["rev-parse", "HEAD", "refs/heads/main"], REPO_ROOT)
  )
    .trim()
    .split("\n");
  return head === main;
}

/**
 * Start the next batch — when the runner is on, this checkout is main's
 * current code, one is owed and none runs.
 */
export async function startNextBatch(): Promise<void> {
  if (!runnerOn()) return;
  if (!(await checkoutIsMainTip())) return;
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
  const paths = selectDueBatch(
    rows.filter(
      (r) => (taken.get(takeKey(r.path, r.digest)) ?? 0) < TAKES_PER_DIGEST,
    ),
  );
  if (paths === null) return;
  const digestOf = new Map(rows.map((r) => [r.path, r.digest]));
  for (const p of paths) {
    const key = takeKey(p, digestOf.get(p)!);
    taken.set(key, (taken.get(key) ?? 0) + 1);
  }
  await idleBatchJob.enqueue({ paths, pool: BATCH_LOCK });
}

async function cancelBatch(): Promise<void> {
  await cancelSupervisedJobByLock(idleBatchJob, {
    paths: [BATCH_LOCK],
    pool: BATCH_LOCK,
  });
}

export const idleNextJob = defineJob({
  name: "tests.idle-next",
  description:
    "Picks the next test files main's test runner owes a verdict (a push changed them, or a failure awaits its one confirming run) and starts them — when the runner is turned on.",
  hold: "seconds",
  input: z.object({}),
  event: z.unknown(),
  // One pending pick; never two at once (each would start a batch).
  dedup: "singleton",
  serial: true,
  run: async () => {
    await startNextBatch();
  },
});

/**
 * Main moved: a batch running now tests a tree that is going away (its
 * harvest is skipped once the checkout changes under it), so it is
 * cancelled, and the digests are brought to the new tree — their settling
 * starts the next batch, on the new code. (When main's own checkout has not
 * moved yet the digest child answers `unchanged`; the boot warm-up below
 * catches the tree the restarted backend serves.)
 */
export const runnerOnMainAdvance = defineRefReaction({
  name: "tests.idle-batch",
  refName: "refs/heads/main",
  run: async () => {
    if (!runnerOn()) return;
    await cancelBatch();
    await requestCheckoutDigests();
  },
});

/**
 * Main's boot: every push restarts main, and a ref reaction is skipped while
 * the backend is down — so the advance that matters most is the one it would
 * miss. The new process serves the new tree: a batch still running was started
 * by a previous backend, in the checkout that backend served (a detached child
 * outlives its backend), so it is cancelled — it tests code this backend does
 * not serve, holds that backend's slot draining, and would keep this runner
 * from starting until it ends. Then the digests are brought to the new tree.
 */
export const runnerAtMainBoot = defineWarmup({
  name: "tests.runner-digests-boot",
  description:
    "When main's test runner is on: cancels a test batch a previous backend left running (it tests the code that backend served, from its slot), then brings main's test digests to the code it now serves, so the runner re-runs what the last push affected.",
  scope: "host",
  run: async () => {
    if (!runnerOn()) return;
    // A batch this backend started already (a trigger ran first) is its own.
    const open = await latestSupervisedRun(idleBatchJob, {
      paths: [BATCH_LOCK],
      pool: BATCH_LOCK,
    });
    if (open?.open && open.startedAt.getTime() < performance.timeOrigin) {
      await cancelBatch();
    }
    await requestCheckoutDigests();
  },
});

/**
 * The switch flipped: on → bring the digests current (their settling starts
 * the first batch); off → stop the running batch.
 */
export function followRunnerSwitch(): void {
  if (!isMain()) return;
  let wasOn = runnerOn();
  watchConfig(testRunnerConfig, () => {
    const on = runnerOn();
    if (on === wasOn) return;
    wasOn = on;
    void (on ? requestCheckoutDigests() : cancelBatch());
  });
}
