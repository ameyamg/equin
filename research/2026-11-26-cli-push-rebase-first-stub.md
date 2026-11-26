# `./equin push` rebases first, in a git-and-sh stub

Decision D5 (dec-1795635663-k7b0k8), task-1795653051-eerkqu. Follows
[`2026-11-06-cli-push-post-rebase-handoff.md`](2026-11-06-cli-push-post-rebase-handoff.md),
which moved everything AFTER the rebase onto the rebased code.

## Problem

Before its rebase, a push ran the branch's own older copy of everything: the
`./equin` wrapper, the bootstrap (`bin/index.ts`, including the main-slots
lease, the data root and `ensureDeps`), the CLI startup (every command
declaration) and the push driver's pre-flight (attribution, fix claims, the
publish probe, commit identity, the test gate, `checkoutRef`, the mutex). A
change on main to any of it broke older branches' pushes until they were
rebased by hand.

Incident, 2026-11-18: after the main-slots change af2629b88d, old branches'
`pushLockFor` → `checkoutRef` threw `MainNamespaceCollisionError` ("work from a
linked worktree"), which would have hit 374 of 386 worktrees. Three reports
came in within about a day (task-1794959293-1u5npu, task-1794962514-24rz1c,
task-1794965155-92b9zf).

## Design

The pre-rebase part is a POSIX sh script, `push/scripts/rebase-first.sh`, run
by `./equin` before anything else when the verb is `push`. It rebases the
branch onto local `main`, writes `refs/equin/push-rebased/<branch>` = the new
HEAD, and exits 10. The wrapper then re-`exec`s the rebased `./equin`, with
`EQUIN_FROZEN_LOCKFILE=1` so the bootstrap's install never re-resolves the
mid-push tree. Re-run there, the stub finds the branch on main and exits 0.

- **Why sh, not TypeScript.** Bun parses and links a module's whole static
  graph before it runs any of it, and the bootstrap is itself code main
  changes (the 11-18 class reaches it through main-slots). A shell step before
  `exec bun` runs nothing but git, and the re-exec of `./equin` runs every
  later line, the wrapper's included, from the rebased tree.
- **The wrapper rewrites itself.** The rebase replaces `./equin` and the stub
  on disk while sh runs them. git writes files as new inodes, so an open sh
  keeps reading the old one. The stub is also one function, parsed whole
  before it runs, and the wrapper `exec`s right after it.
- **Onto local `main`, no fetch.** Local `main` is what every push on this
  machine lands on, and what the driver rebases onto. A fetch would need the
  publish decision (`resolvePublishTarget`), which is not git-only. The driver
  still fetches and rebases under the mutex; the land-phase hand-off covers
  commits that land in between.
- **Uncommitted work** becomes a temporary commit (`--no-verify`), rides the
  rebase, and is reset back to uncommitted (mixed reset: untracked files are
  untracked again). A trap does the same on INT/TERM/HUP mid-rebase. If the rebase drops it because
  main already has those changes, the subject check (`restore_wip`) leaves the
  branch's own commit alone. A dirty tree with no `-m` is left alone, since
  the driver refuses it anyway.
- **Arm 1 vs arm 3.** After the stub, the branch contains main, which would
  send it to arm 1 (tip-only trailer amend). Over the last 30 days 56 of about
  2,100 pushes had more than one commit, and every one of their non-tip
  commits would have lost its trailers. The ref tells the driver the branch
  was behind main and linear, so it takes arm 3, whose `rebase --exec`
  re-stamps every commit. A ref and not an env var (the first draft), because
  a push refused after the stub (test gate, main collision, Ctrl-C in the
  queue) retries on a branch that already contains main: with an env marker
  the retry took arm 1 (found in review). The driver honours it only while it
  is an ancestor of HEAD, and deletes it once the branch is in landing shape. Measured: `git rebase main --exec …` on an
  up-to-date branch still replays every commit and runs the exec.
- **Left alone** (exit 0, driver unchanged): the branch contains main, has
  merge commits, is `main` or a detached HEAD, has a git operation in
  progress, has no committer identity, or `--help` was asked for.

## Enforcement

- `push:rebase-first-stub` check: `./equin` has only `set -e` and `cd` above
  the stub's `if [ "${1:-}" = push ]` block, and the stub has no command that
  runs `bun`, `./…`, a repo path, `node_modules` or a sourced script.
  Heredoc messages and comments are not commands.
- `scripts/rebase-first.test.ts`: the stub in a temp repo with none of this
  tree, with only git, sh and cat on PATH. It covers a rebase, dirty work
  carried across, a conflict restored, and the left-alone cases.
- `push/e2e/post-rebase-handoff.ts` now reproduces the incident's shape. Main
  changes the driver's code that runs before its rebase, and the push must
  print main's version. Two branch commits must both carry the push trailer.

## What still runs pre-rebase, and why it cannot move

- `./equin` lines 1–3 (`#!/bin/sh`, `set -e`, `cd "$(dirname "$0")"`) and the
  `push` guard. Something has to start the stub, and these are the smallest
  start possible.
- `rebase-first.sh` itself. It is the rebase, and the rebase has to run before
  the rebased code exists. Its surface is git's CLI, POSIX sh and `cat`.
- Its cross-version contract: exit 0 or 10, the `refs/equin/push-rebased/`
  ref and the driver's reading of it, and `EQUIN_SKIP_POST_REWRITE` (its rebase
  runs the checkout's hooks and merge drivers like any `git rebase`; the
  post-rewrite hook must keep honouring that name). A change must stay readable by older wrappers, like
  `cli/handoff.ts`.

Branches cut before this lands still run their old pre-rebase code. Only
future breaking changes are covered, the same scope the 11-06 hand-off took.
