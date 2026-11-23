# Broken tests on main: one channel, one owner, main follows its head

Task: task-1795431631-8vvvq1 (decisions D3 + D4 of the test audit, agent page
block-52e26874-5a94-4077-8e16-839523f9ae8b). Builds on the push test gate
(b000df31a5, `framework/cli/push/plugins/test-gate`,
`research/2026-11-23-framework-push-affected-tests-gate.md`).

## Context

- 13 `test-failing` reports are open with no task: the `error-reports`
  supervisor stream routes them to an unlisted role with the default `drop`
  idle policy, and nothing else turns a report into a task.
- The Test supervisor role has no prompt and no session; 39 backlog tasks
  from 37 agents, 4–8 duplicates per failure. Agents cannot see what is
  already known, so ~43% of the failures they hit (already failing on main)
  are re-diagnosed and re-filed.
- Main's idle runner last ran 11-21: it runs only while the host is idle, its
  digests refresh only when Debug → Tests is open or idle begins (stuck 54
  commits behind), and its confirmation queue (`toConfirm`) is process memory
  that every deploy (= every push) wipes.
- Bookkeeping: `test_file_status` takes `status` from the current digest but
  `last*` from the newest result at ANY digest (mixed origins); a zero-case
  bun file is recorded `not-loaded` whenever another file in its batch fails.

## Target journey and how each step is met

### 1. At push (exists: test gate)

The gate already blocks new failures and lets pre-existing ones through. Added:
a pre-existing failure prints its `test-failing` report and owner task when
main has one (see §3, the shared "standing on main" lookup).

### 2. On main: verdicts follow main's head

- **Digests follow the head.** `tests.checkout-digests`' ref reaction on
  `refs/heads/main` requests new digests on MAIN on every advance (not only
  while the page is watched). Worktrees keep the watcher gate.
- **Due files run without waiting for idle.** The idle runner's selection is
  split in two pools, both derived from persisted state (no process-memory
  queue):
  - **due** — run as soon as possible, opportunistic (background lane, low
    priority — the same `EQUIN_OP_OPPORTUNISTIC` the idle batches use),
    whether the host is idle or not:
    - `stale` / `never` (the files a main advance affected that no run —
      the push gate's included — has a verdict for at their new digest);
    - **to confirm**: main's own runs at the current digest are exactly one
      failure and no pass (replaces `toConfirm`);
    - **seen failing elsewhere**: a failure at main's current digest from
      another checkout (an agent's run of main's code), and no own verdict at
      it — the agent's run is the evidence, main verifies it.
  - **sweep** — only while idle (unchanged): verdicts older than 7 days, and
    failing files older than 1 day (an env or flake fix shows up).
  - `host.idleEnded` cancels only a sweep batch.
  - A (path, digest) is taken at most twice per backend process (loop guard
    for a run that yields no verdict; replaces `takenThisIdle`).
- Failing files are re-run whenever their digest moves (they go `stale`),
  so a fix landing is observed; a confirmed pass→fail files or bumps ONE
  `test-failing` report per file with the last-green..first-red range
  (unchanged rule, `judgeFailingFile`).
- To derive "to confirm" / "seen elsewhere", `test_file_status` gains
  `ownPassed` / `ownFailed` (results on the current digest from this
  checkout's own runs — `slug` = this backend's namespace).

### 3. An agent hits a failure: "standing on main"

New sub-plugin `framework/cli/test/plugins/main-standing` — the ONE notion of
"already failing on main", moved out of the test gate (which imports it):

- `core`: `VerdictIndex` / `buildVerdictIndex`, `judgeFailure`,
  `describeJudgement`, `isProvingPass` (moved verbatim from test-gate core).
- `cli`: `readTestRunRecords` (moved), `mainBaseDigests(root)` (merge base
  with `main` + its test digests — the gate's code), and
  `readTestFailingReports(paths)`: main's open `test-failing` reports for
  these paths (fingerprint `test-failing:<path>` → report id, owner task,
  fix state), read with `openShortLivedClient` like
  `reports/engine/cli`'s `resolveFixedReports`.
- `standingOnMain(root, failing)` → one line per failing file:
  - known on main → `report-… (owner task task-…, open|pending|regressed)`;
  - fails on main's code, not reported yet → "main verifies it from this
    run's record and files the report";
  - passes on main's code / new file → "this checkout's change".

`./equin test` prints it after a run with failures (`TESTS_FAILED_EXIT`),
outside the main checkout, and ends with: never file a broken test as a
task — known ones have an owner, unknown ones reach main through this run's
record. A lookup failure (main's DB unreachable) is printed, never changes
the exit code. The gate's spawned `./equin test` passes an env flag to skip
it (the gate prints its own judgement, with the report link).

Root `CLAUDE.md` Testing section says the same. (The Test supervisor role's
description "You can report broken tests on main to this supervisor" invites
filing; it is user data — flagged in the outcome report.)

### 4. Ownership: one task per open report

`test-failing` reports are auto-investigated:

- A `ReportRecorded` listener in `failing-report` (it fires for a report with
  no task that is not noise — new, recurring, or regressed: the engine
  unlinks a regressed report's task and announces it again) enqueues
  `tests.failing-owner` (machine, main), which calls `investigateReport`.
- A boot warm-up runs the same for every open `test-failing` report with no
  live task (the 13 today).
- `investigateReport(id, { owner })` grows an optional owner: the
  investigation sink request carries `author: "human" | "system"` and
  `ownerRole: string | null`; the tasks bridge (`reports-investigation`)
  files a system task into the role's backlog (`fileSystemBacklogTask`) when
  a role is named, else the plain Reports-category root task. Idempotent as
  today (a linked live task is reused).
- The role is a config, `tests.failingOwnerRole` (Settings → Config, a
  supervisor role id, default unset → plain unowned Reports task). The Test
  supervisor session (when the user points the config at it) owns every new
  task AND the 39 old backlog tasks, so it can drop the duplicates itself
  (D7) — this change drops nothing.

So each open report has exactly one task (the report's `task_id`), created by
the system, re-created when a fix regresses.

### 5. Closure (exists: fix ledger)

A fix pushes `--fixes-report <id>`: Fixed when deployed; the failing file's
digest moved, so main re-runs it as `due` — a failure on code containing the
fix is a regression (engine `fix-regression`), unlinks the task and §4 files a
new one. The investigation task body tells the owner to push with
`--fixes-report`.

### Bookkeeping fixes

- **Mixed origins**: `recomputeFileStatus` takes `last*` (outcome, origin,
  slug, op, cases, duration) from the newest result on the CURRENT digest
  when there is one, else the newest overall (the stale case).
- **Zero-case file `not-loaded`**: bun's JUnit omits both a file that threw
  while loading and one that registered no case. When a bun runner exits
  non-zero and some given files are unreported, `./equin test` runs those
  files again in one more bun process (`runRunner`, same env/group/heartbeat)
  and merges its report: a file it reports gets that verdict; if that probe
  exits 0 the still-unreported files registered no cases (no row); if it
  fails, each still-unreported file is probed alone, and one that still
  fails unreported is `not-loaded`. Measured: bun's JUnit is identical for
  the two cases (scratch probe, bun 1.4.5), so only the exit code of a run
  without the other files can tell them apart.

## Files

- `plugins/debug/plugins/tests/core/internal/{status,entities}.ts`,
  `server/internal/recompute.ts` (+ migration via build)
- `plugins/debug/plugins/tests/machine/internal/checkout-digests.ts`
- `plugins/debug/plugins/tests/plugins/idle-runner/machine/internal/{idle-runner,select-batch}.ts`
- `plugins/debug/plugins/tests/plugins/failing-report/{core,machine,server}` (owner job, warm-up, listener, config)
- `plugins/reports/server/internal/investigation-sink.ts`,
  `plugins/reports/plugins/engine/server/internal/investigate.ts`
- `plugins/tasks/plugins/reports-investigation/server/internal/register.ts`
- new `plugins/framework/plugins/cli/plugins/test/plugins/main-standing`
- `plugins/framework/plugins/cli/plugins/push/plugins/test-gate` (imports it)
- `plugins/framework/plugins/cli/plugins/test/cli/run.ts` (probe + standing)
- docs: the CLAUDE.md of each touched plugin, root `CLAUDE.md` Testing

## Verification

- Unit: `deriveStatus`/recompute last-fields and own counts (status.db test),
  `selectIdleBatch` pools (select-batch test), `judgeFailingFile` unchanged,
  main-standing judge tests (moved), standing line rendering.
- Zero-case probe: scratch dir with a failing file, a zero-case file and a
  throwing file through `./equin test` → rows passed/failed, none, not-loaded.
- `./equin test` on a file failing on main from this worktree prints its
  report and owner task.
- Build + boot: the warm-up files the 13 tasks only on main (worktree is not
  main — verify the code path with a db test on the bridge).

## Revised after the design review

An independent review found holes; adopted:

- **Digests after a restart.** A ref reaction is skipped while main's backend
  is down — and every push restarts it. Main also requests its digests in a
  boot warm-up (the new process has the new tree), and a digest set that
  changed recomputes only the paths whose digest moved (plus deleted ones),
  not all ~3.1k rows on every push.
- **One channel, one role config.** `report-streams` already announces every
  report to the role its category's stream is routed to. A new report
  category `test` (a test of the app's own code fails on main) feeds a new
  **Broken tests** stream; that stream OWNS its reports instead of
  announcing them: each report gets its one investigation task, filed into
  the routed role's backlog (or a plain Reports task while unrouted). No
  `tests.failingOwnerRole` config, and `test-failing` is off the error stream,
  so it can never reach two owners. The boot warm-up lives there too.
- **"Owned" is one definition**: a report is owned while its task is neither
  dropped nor done — the bridge and the warm-up share it.
- **Never-passed files are reported.** `judgeFailingFile`'s
  `never-passed-here` left a file broken past the results cap (or broken since
  it landed) with no report, ever. Confirmed failures of main's own now report
  with `lastPassed: null` ("no pass on main on record").
- **A file with no case is a pass with 0 cases**, not "no row": otherwise it
  is `never` forever and due after every restart. The gate already accepts a
  0-case pass and never reuses it.
- **The probe bisects** when many files are unreported (a broken preload
  leaves all of them): halves, recursively, so k crashing files of n cost
  O(k log n) runs.
- **Due batches**: a main advance cancels the running batch (its harvest
  would be skipped anyway — the tree moved); ingesting another checkout's
  record with failures asks for the next selection.
- **No daily re-run of failing files** (it re-rang every broken file's bell
  daily): failing files re-run when their digest moves, and by the 7-day sweep.
- **"Own run" is one definition**: `slug` = this backend's namespace, in the
  status recompute and in the failing-report judge (was `repo` there).
- **Storm collapse**: `test-failing` raises its fan-out ceiling, so a push
  breaking many tests files each one.

Not adopted: replacing `judgeFailure` in `./equin test` with a lookup of
main's status row (the supervisor asked for one notion — the gate's).

## Revised at landing

Main landed one bun:test process per file (43c1a6f5da) and an empty suite for
a file whose process ran no case (fa8b0ef6ee) while this was in review. Each
file's own exit code now tells a load crash from a file with no case, which
fixes the zero-case `not-loaded` bug at its source, so the bisecting probe
designed above was dropped before landing.
