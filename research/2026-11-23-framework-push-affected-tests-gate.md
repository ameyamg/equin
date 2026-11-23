# Push runs the tests its change affects

Task: task-1795431596-pgii9v (decision D0 of the test audit, agent page
block-52e26874-5a94-4077-8e16-839523f9ae8b).

## Context

`./equin push` and `./equin build` run checks, never tests. Between 11-12 and
11-20 about two persistent test breakages a day landed on main, each caused by
ONE commit in a different plugin from the test it broke (cda6e0e246,
6d59f998d1, 1e701291e9, b5f3fc11a5). Agents run targeted tests (median 4
files), so they never see what they broke elsewhere; 7% of pushing attempts
pushed while their own last run was failing.

Goal: `push` runs the tests the change affects and refuses a change that
newly breaks one, without blocking on a test that already fails on main.

## What already exists (reused, not rebuilt)

- **Test digest** (`framework/cli/test/plugins/digest`): `testDigests(snapshot,
  store, files)` keys each test file by its whole import closure (static +
  dynamic, plugin-records' module graph), its runner's inputs (bunfig, the
  preload's / vitest config's static closure) and the npm resolutions. ~0.6 s
  for all 3,122 test files with a warm record store.
- **Harvest** (`framework/cli/test` `harvest.ts`, `record`): every
  `./equin test` run, in any checkout, writes one `TestRunRecord` to the
  host-global `test-runs` dir: each file's outcome under its digest, plus its
  failing cases. Kept 14 days (~4,200 records, ~36 MB today). Main's idle
  runner writes its verdicts there under slug = main's namespace.
- **The module graph reads through the snapshot** and caches file facts by
  blob, so a snapshot of a COMMIT (blob ids from `git ls-tree`, content from
  `git cat-file` on a cache miss) digests a past tree at nearly the same cost.

## Design

### 1. "Affected" = the test digest moved

A test file is affected when its digest at HEAD differs from its digest at
the merge base `B = merge-base(HEAD, main)`, or it does not exist at B.

Why the digest rather than "closure ∩ changed files": it is the SAME key every
harvested verdict is stored under, so selection, verdict reuse and the
"already failing on main" lookup all speak one identity. It also catches the
cases a changed-files walk misses: a runner-input change (bun preload closure,
bunfig, vitest config/setup) and a lockfile change, which can break any test.

Measured over the last 40 commits on main (digest at commit vs parent, sum of
each file's last known duration):

| | affected files | test time |
|---|---|---|
| median | ~60 | ~110 s |
| p75 | ~600 | ~600 s |
| max (lockfile, preload closure) | 3,147 | ~1,050 s |

Restricting to the file's own closure (dropping runner inputs + npm) only
shaves the top few commits (3,147 → 1,540 for an icon-package bump), so it is
not worth a second notion of "affected".

### 2. Verdict reuse: a recorded pass at the same digest counts

Before running, the gate reads the harvest: an affected file with a `passed`
verdict recorded at its HEAD digest (by any run — usually the agent's own
targeted run) is already verified and is not run again. Sound by the digest's
contract (same closure + runner inputs + npm ⇒ same code under test), with the
digest's documented blind spots (§5).

### 3. Run the rest with `./equin test <files>`

One ordinary `./equin test` over every affected file without a recorded pass
— the same command, its own op, grant, flight sharing, record. The gate learns
the results by reading the harvest again: each file must have a verdict at its
HEAD digest from a run that started after the gate did. A file with none (a
wedged runner, a harvest that failed, the tree edited mid-run) fails the gate
loudly — "no verdict", never an assumed pass.

### 4. New failure vs already failing on main

For each file that failed (`failed` or `not-loaded`) at HEAD, in order:

1. **Not at B** (a new test file) → new failure.
2. **A verdict at its B digest** (newest one) → `failed`/`not-loaded`:
   already failing at the merge base, allowed; `passed`: new failure.
3. **No verdict at its B digest** → main's latest verdict for the path (a run
   on main's checkout — the idle runner — at any digest): failing → allowed as
   "failing on main since <date>"; passing or never run → new failure, and the
   message says the evidence was missing.

Per FILE, not per case: a file that already fails witnesses nothing, whichever
cases fail (the deps upgrader learned this the hard way, 634ed8e147 —
health-report fails a different handful of cases on every run).

**Confirmation.** A file judged a new failure is run once more, alone with the
other new failures, before the push is refused: batch-mode failures caused by
another file's leaked state (audit root cause G) pass there and are reported
as "failed in the batch, passed alone — not blocking". Not a retry that hides
anything: both verdicts are in the harvest, so Debug → Tests shows the file
flaky.

The push is refused when any file failed both runs. The message lists each
file with its evidence and the `./equin test <files>` command to reproduce.

### 5. Tests reached by data, not imports

The digest's blind spots stay blind (dynamic preload providers,
`import.meta.glob`, fixtures read from disk, spawned processes, env, migrations
applied, the composition registry alias; Go tests). They are not chased here:

- tests that scan the live repo are being turned into checks / synthetic
  fixtures (audit root causes E, F — task-1795431605-5twm2g /
  task-1795431612-3uikn3), which removes the class rather than tracking it;
- main's idle runner (D3/D4, task-1795431631-8vvvq1) is the backstop for what
  the digest cannot see.

### 6. Where in push, and the cost budget

**Before the push mutex**, right after the commit step (worktree mode), on the
committed HEAD. The mutex is host-wide: every queued push waits on the holder,
and the test step is the slowest part (up to ~17 min for a lockfile change). Run
inside it, it would serialize the whole fleet behind it.

Accepted gap, stated: the gate tests HEAD against its merge base, not the
rebased tree that lands. A semantic conflict with a commit main gained since
the merge base is not caught (every breakage the audit found was a single
commit, so this is the minority class); main's idle runner catches it.

**Budget: no cap.** The measured median adds ~2 min of test time to a push that
already takes ~10 min, the tail up to ~17 min, outside the mutex; verdict reuse
removes most of it when the agent already ran the tests it touched. The gate
prints the count and the estimated time (last known durations) before it
starts. A cap would let exactly the wide changes — the ones most likely to
break something far away — through untested.

`--from-main` is not gated (a user-approved emergency path; stated in its docs).

## Implementation

New sub-plugin **`framework/cli/push/plugins/test-gate`** (the push owns its
gate; test machinery stays in `framework/cli/test`):

- `core/` — pure, unit-tested:
  - `affectedTests(head: Map<path,digest>, base: Map<path,digest>)`;
  - `VerdictIndex` built from records: `at(path, digest)` newest verdict,
    `latestOnMain(path)`, `durationOf(path)`; `since` filter;
  - `judgeFailure(...)` → `{ kind: "new" | "pre-existing", evidence }`;
  - the report lines.
- `cli/` — `runTestGate({ root, mainRef })`: merge base, the two snapshots,
  digests, read the records dir, spawn `./equin test` (passthrough output),
  re-read, judge, confirm, print; returns `{ ok } | { ok:false, message }`.
- `framework/tooling/core`: `commitSnapshot(root, rev): RepoSnapshot` — blob ids
  from `git ls-tree -r -z`, `read` through `git cat-file` (the working-tree
  `read` would answer HEAD's bytes for a base path).
- `framework/cli/test/plugins/record/core`: a `readTestRunRecords(dir)` reader
  if one is not already exported by `debug/tests` ingest (machine-only, not
  importable from cli) — shared by the gate.
- `framework/cli/push/cli/run.ts`: call the gate after step 1b in worktree
  mode, before `withPushLock`; on refusal print and exit 1 (no op record — a
  push that never contended for the mutex writes none, as today).
- Docs: push `CLAUDE.md` (the step, the gap, the budget), the test-gate
  `CLAUDE.md`, root `CLAUDE.md` Push steps list, test `CLAUDE.md` ("Nothing
  runs on push" line in `debug/tests` becomes false).

## Verification

- Unit tests for `affectedTests`, the verdict index and `judgeFailure`
  (new test file, base failing, base passing, base unknown + main failing,
  base unknown + nothing).
- `commitSnapshot` test against a temp repo (a base path's bytes come from the
  commit, not the working tree).
- End to end: in this worktree, run the gate on this branch (affected = the
  gate's own tests + push's) via a scratch script; then a scratch branch that
  breaks a widely imported module's behaviour to see a refusal naming the
  broken test; then a branch touching the closure of a file already failing on
  main to see it allowed.
- The real `./equin push` of this change runs the gate on itself.

## Revised after the design review

An independent review found holes; adopted:

- **Results are matched by tree, not by time.** "Started after the gate" broke
  when `./equin test` joined an identical in-flight run (the leader writes the
  record, earlier) and when the tree changed mid-run (harvest skipped). The gate
  now takes the NEW records whose `treeHash` is HEAD's tree, and refuses a
  dirty tree up front.
- **`not-loaded` is no evidence** (an interrupted runner leaves it for every
  file it did not reach), and verdicts at the merge-base digest decide by
  **majority** (a tie = failing), not by the newest one.
- **Pre-existing failures are printed loudly**, with any failing case no run
  on main saw fail (warning).
- **Confirmation runs each suspect on its own** (its own runner process), not
  "alone with the other suspects" (still one shared bun process).
- **Reuse needs a pass that ran ≥ 1 case** (an all-skipped file proves nothing).

Not adopted now (follow-ups): rebasing onto main before the gate (changes the
in-mutex landing arms and their trailer semantics); sharding bun files across
the grant; re-running an unattributed (wedged) runner's files in smaller
batches; blocking a change that makes a file leak state into others (only
warned: the batch-only failure is printed).
