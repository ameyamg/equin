# test-gate

The push's test gate: `./equin push` (worktree mode) runs the tests its change
affects and refuses a change that newly breaks one. Design and measurements:
[`research/2026-11-23-framework-push-affected-tests-gate.md`](../../../../../../../../research/2026-11-23-framework-push-affected-tests-gate.md).

Why: between 11-12 and 11-20 about two persistent test breakages a day landed
on main, each from one commit in a different plugin from the test it broke.
Agents run the tests they think of; nothing ran the tests the change reached.

## What it does, in order

1. **Refuses a dirty tree** — its verdicts are about HEAD's tree only.
2. **Affected = the test digest moved** between the merge base with local
   `main` and HEAD (`test/plugins/digest`: the file's whole import closure, its
   runner's inputs, the npm resolutions), or the file is new. The base is read
   from git objects (`commitSnapshot`), never the working tree; its `root`
   names the commit, so plugin-records' producers read their own code from the
   running checkout rather than keying it by the past tree's version of it.
3. **Reuse**: a file whose newest conclusive verdict at its HEAD digest — any
   checkout's harvested run, usually the agent's own — is a pass that ran at
   least one case is not run again.
4. **One `./equin test <files>`** over the rest. Its results are read back from
   the harvest (`test-runs` records), never from its exit code: the new records
   whose `treeHash` is HEAD's tree (the run it led, or the identical in-flight
   run it joined). A file with no such verdict, or a `not-loaded` one (the
   runner never reached it), refuses the push (`NO VERDICT`) — a wedged runner,
   a failed harvest, an edit mid-run — never an assumed pass. A pass with zero
   cases (every case skipped here) is accepted at HEAD but never reused.
   An unreadable file in the shared records dir is named and left out, so one
   truncated write cannot refuse every push on the machine.
5. **Each failing file is judged** (`judgeFailure` from
   `test/plugins/main-standing` — the one notion of "already failing on main",
   shared with `./equin test`; per file, never per case):
   - not at the merge base → new;
   - verdicts at its merge-base digest (any checkout; `not-loaded` ignored — an
     interrupted runner leaves it for every file it did not reach) → by
     majority, a tie counting as failing;
   - **no verdict there → the gate establishes one**: every such file runs
     with `./equin test` in a throwaway detached checkout of the merge base
     (`cli/internal/scratch-checkout.ts`: `infra/worktree`'s crash-safe add,
     deleted afterwards; ~1.5 min with its install), whose harvest records it
     at exactly the merge-base digest — then it is judged again on that.
     The checkout gets a database forked from main's (`./equin db fork`, as
     every agent worktree starts with), so suites that drive the checkout's
     own database do not fail there for want of one; its namespace is stamped
     first, so a killed push leaves it to the worktree reaper. Still no
     verdict (`NO VERDICT AT THE MERGE BASE`) refuses the push. Because that
     checkout's environment is fresh, a failure there settles the file as
     pre-existing only when it failed every case that fails here; a case
     failing only here makes it a suspect (step 6).
   Main's own newest verdict at another digest (`judgeFailure`'s last rung,
   `restsOnMergeBase` false) never decides here: on 2026-11-23 the idle
   runner's last verdicts were from 11-21, two breakages had landed since,
   and the gate refused an unrelated push on them as "passing on main".
   Pre-existing failures are printed loudly, with main's `test-failing` report
   and owner task for each (`standingLines`) and any failing case no run on
   main saw fail — a warning, not a refusal.
6. **Each suspect runs again on its own** (its own runner process). Passing
   there = another file's state leaked into it in the shared bun process: a
   warning, not a refusal (both verdicts are harvested, so Debug → Tests shows
   it flaky). Failing again = refused, with the command that reproduces it.

## Placement and known gaps

Before the push mutex: the gate is the slowest step (median ~2 min of test
time, ~17 min when the lockfile or the bun preload's closure moves — every
test), and every queued push would wait on it inside the mutex. No budget cap:
a cap would let exactly the wide changes through untested.

- It tests HEAD against its merge base, not the rebased tree that lands: a
  conflict with what main gained since is main's idle runner's to catch.
- The digest's blind spots are the gate's (files read from disk, spawned
  processes, env, `import.meta.glob`, …; `digest/CLAUDE.md`). Tests that scan
  the live repo are being made checks or synthetic fixtures instead.
- A test already failing on main can gain new failing cases unblocked (warned).
- A file this change makes leak state into OTHER files in a batch shows as a
  batch-only failure of those files: warned, not refused.
- `--from-main` is not gated.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: The push's test gate: before the push mutex, run every test file whose test digest moved since the merge base (a pass already recorded at the same digest counts), and refuse the push when one newly fails — telling a test that already fails on main (its verdict at the merge base, established by running it there in a scratch checkout when none is recorded) from one this change broke, and a batch-only failure (passes when run again alone) from a real one.
- Cli:
  - Uses:
    - `framework/cli/test/main-standing.mainSlug`
    - `framework/cli/test/main-standing.readTestRunRecords`
    - `framework/cli/test/main-standing.standingLines`
    - `framework/cli/test/main-standing.standingOnMain`
    - `plugin-meta/plugin-records.openRecordStore`
  - Exports (types): `TestGateResult`
  - Exports (values): `runTestGate`
- Cross-plugin:
  - Imported by: `framework/cli/push`
- Core:
  - Exports (values): `affectedTests`

<!-- AUTOGENERATED:END -->
