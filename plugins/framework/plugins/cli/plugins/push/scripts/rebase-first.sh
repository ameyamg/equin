#!/bin/sh
# push's pre-rebase stub: put the branch on top of local `main` BEFORE any of
# the branch's own TypeScript runs, so `./equin push` runs main's code, not the
# branch's older copy of it.
#
# Why. Everything `./equin push` ran before its rebase used to be the BRANCH's
# code: the CLI's startup, the push driver's path and checkout resolution, its
# pre-flight checks, the rebase itself. A change on main to anything on that
# path broke every older branch's push until it was rebased by hand — on
# 2026-11-18 main's slots (af2629b88d) made old branches' checkoutRef throw
# MainNamespaceCollisionError before the rebase, for 374 of 386 worktrees
# (research/2026-11-26-cli-push-rebase-first-stub.md).
#
# Run by `./equin` for `push`, before Bun starts. Exit status is the contract
# with that wrapper (`./equin`, the same branch's copy):
#   0   nothing done — run the push as it is (already on main, nothing to
#       rebase, a shape the driver must judge itself, help asked for)
#   10  rebased — re-exec `./equin` (the rebased one)
#   *   refused or failed; the reason is printed here
# and one ref with the driver: `refs/equin/push-rebased/<branch>`, the HEAD this
# stub rebased to. It tells the driver (cli/run.ts) the branch was behind main
# and linear — so it re-stamps every commit — and outlives a refused push, so
# the retry knows it too.
#
# The rebase is an ordinary `git rebase`: the checkout's hooks and merge drivers
# run as they do for one typed by hand. EQUIN_SKIP_POST_REWRITE keeps the
# post-rewrite hook from normalizing against the branch's node_modules (the
# driver normalizes after its install); that name is part of the contract too.
#
# THE STABILITY RULE: this file runs on a branch's OLD copy against a world
# main's NEW code shaped, so it may depend on nothing main changes — git and
# POSIX sh only. It reads and runs no other repo file (no `bun`, no `./equin`,
# no sourced script). The `push:rebase-first-stub` check enforces that, and
# `rebase-first.test.ts` runs it with only git and sh on PATH. Every decision
# that needs more than git — publishing, attribution, the mutex, trailers —
# stays in the driver, which now runs on main's code.
#
# Everything is inside one function, parsed whole before it runs: the rebase
# rewrites this very file on disk.

rebase_first() {
  # Help, or no message for a dirty tree: nothing will land, so nothing to move.
  message=no
  for arg in "$@"; do
    case $arg in
      -h | --help) return 0 ;;
      -m | -m?* | --message | --message=*) message=yes ;;
    esac
  done

  branch=$(git symbolic-ref --quiet --short HEAD) || return 0 # detached HEAD
  [ "$branch" = main ] && return 0                            # --from-main's arm
  git rev-parse --verify --quiet 'main^{commit}' >/dev/null || return 0

  # Already on top of main: nothing to bring in.
  git merge-base --is-ancestor main HEAD
  case $? in
    0) return 0 ;;
    1) ;;
    *)
      echo "push: could not tell whether $branch contains main (git merge-base failed)." >&2
      return 1
      ;;
  esac

  # Merge commits: a rebase would flatten them. The driver refuses or lands
  # them by its own rules; this stub never rewrites a merge.
  merges=$(git rev-list --merges --count main..HEAD) || return 1
  [ "$merges" -eq 0 ] || return 0

  # A rebase, merge, cherry-pick or revert in progress is the user's to finish.
  for state in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD; do
    [ -e "$(git rev-parse --git-path "$state")" ] && return 0
  done

  # No committer identity: the driver writes one (or refuses) before ITS
  # rebase; this stub never invents one.
  git var GIT_COMMITTER_IDENT >/dev/null 2>&1 || return 0

  dirty=$(git status --porcelain) || return 1
  if [ -n "$dirty" ] && [ "$message" = no ]; then return 0; fi

  echo "Rebasing $branch onto main first, so this push runs main's code..."

  # Uncommitted work rides the rebase as a temporary commit, then is put back
  # uncommitted — the driver commits it with -m as before.
  # --no-verify: no hook judges a commit that is undone below.
  wip=""
  if [ -n "$dirty" ]; then
    wip="equin push: uncommitted work, carried across the rebase ($$)"
    git add -A || return 1
    if ! git commit -q --no-verify -m "$wip"; then
      echo "push: could not set the uncommitted work aside for the rebase; nothing was committed." >&2
      git reset -q
      return 1
    fi
  fi

  # Interrupted mid-rebase, the work must not stay in a temporary commit.
  trap 'git rebase --abort 2>/dev/null; restore_wip "$wip"; exit 130' INT TERM HUP
  if ! EQUIN_SKIP_POST_REWRITE=1 git rebase -q main; then
    if ! git rebase --abort; then
      echo "push: the rebase onto main failed and could not be aborted." >&2
      [ -n "$wip" ] && echo "Your uncommitted work is in the commit \"$wip\"." >&2
      return 1
    fi
    trap - INT TERM HUP
    restore_wip "$wip" || return 1
    [ -n "$wip" ] && commit_first="
  0. Commit your uncommitted work first: git add -A && git commit -m '<message>'" || commit_first=""
    cat >&2 <<EOF
Rebase of $branch onto main failed (aborted). Nothing was pushed; your branch
and your uncommitted work are as they were.$commit_first

Conflicts during this rebase are routine when main has moved — resolve them yourself, don't bail out.

To resolve:
  1. git fetch origin main
  2. git rebase origin/main     (NEVER 'git merge' — push re-rebases and a merge commit produces churn)
  3. Resolve conflicts, then 'git add <files>' and 'git rebase --continue'
     (or 'git rebase --abort' to bail out)
  4. Re-run ./equin push
EOF
    return 1
  fi
  trap - INT TERM HUP
  restore_wip "$wip" || return 1
  git update-ref "refs/equin/push-rebased/$branch" HEAD || return 1
  return 10
}

# Undo the temporary commit, its changes uncommitted again (untracked files
# untracked). A commit the rebase
# dropped (main already had every change in it) leaves nothing to undo. Matched
# on the subject: the prepare-commit-msg hook may add a trailer to the body.
restore_wip() {
  [ -n "$1" ] || return 0
  [ "$(git log -1 --format=%s HEAD)" = "$1" ] || return 0
  if ! git reset -q HEAD~1; then
    echo "push: could not put the uncommitted work back; it is in the commit \"$1\" (HEAD)." >&2
    return 1
  fi
}

rebase_first "$@"
