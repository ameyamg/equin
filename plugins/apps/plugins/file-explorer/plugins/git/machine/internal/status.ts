import {
  GitError,
  parseDiffNameStatusZ,
  runGit,
  tryRunGit,
} from "@plugins/primitives/plugins/commit-list/server";
import { withHeavyReadSlot } from "@plugins/infra/plugins/host/plugins/host-read-pool/server";
import type { GitStatus } from "../../shared/resources";
import { assembleStatus, parsePorcelainV2Z } from "./parse-status";

/**
 * One read of the whole checkout, bounded by what changed: untracked folders
 * come back collapsed. Never `--ignored`: git disables its untracked cache for
 * any `--ignored` read, so one walks every directory of the tree (0.9 s on
 * main's checkout, 9.7k folders, quiet; 2.4 s under load) where this read rides
 * the untracked cache and fsmonitor (0.14 s). What git ignores is asked per
 * folder the browser lists instead (`ignored.ts`).
 */
const STATUS_ARGS = [
  "status",
  "--porcelain=v2",
  "-z",
  "--branch",
  "--untracked-files=normal",
];

const MAIN = "refs/heads/main";

/** `main`'s commit, or `null` when the checkout has no `main` branch. */
async function readMain(root: string): Promise<string | null> {
  const res = await tryRunGit(
    ["rev-parse", "--verify", "--quiet", `${MAIN}^{commit}`],
    root,
  );
  return res.ok ? res.stdout.trim() : null;
}

/** `merge-base main HEAD`; `null` without a `main` or a common ancestor (exit 1). */
async function readMergeBase(root: string): Promise<string | null> {
  if ((await readMain(root)) === null) return null;
  const args = ["merge-base", MAIN, "HEAD"];
  const res = await tryRunGit(args, root);
  if (res.ok) return res.stdout.trim();
  if (res.exitCode === 1) return null;
  throw new GitError({
    args,
    cwd: root,
    exitCode: res.exitCode,
    stderr: res.stderr,
  });
}

/**
 * The checkout's status: one `git status`, then the merge-base and one
 * `git diff` against it. Read once per push and nothing besides it — no
 * signature probe in front of it, no ETag behind it: the probe would be the
 * same `git status` the read starts with, and an unchanged answer already
 * ships no frame (the runtime compares a push with what its holders hold).
 */
export async function computeGitStatus(root: string): Promise<GitStatus> {
  return withHeavyReadSlot(async () => {
    const porcelain = parsePorcelainV2Z(await runGit(STATUS_ARGS, root));
    const mergeBase =
      porcelain.head === null ? null : await readMergeBase(root);
    const vsMain =
      mergeBase === null
        ? []
        : parseDiffNameStatusZ(
            await runGit(
              ["diff", "-M", "-z", "--name-status", mergeBase],
              root,
            ),
          );
    return assembleStatus(porcelain, mergeBase, vsMain);
  });
}
