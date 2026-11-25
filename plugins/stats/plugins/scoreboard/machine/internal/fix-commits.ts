import { ensureMainWorktreeRoot } from "@plugins/infra/plugins/worktree/server";
import { GIT } from "@plugins/infra/plugins/paths/server";
import { spawnExpectOk } from "@plugins/infra/plugins/spawn/core";
import {
  FIXES_REPORT_TRAILER,
  FIX_LEVEL_TRAILER,
  fixLevelOf,
  type FixLevel,
} from "@plugins/reports/core";
import { LEGACY_IDS } from "@plugins/framework/plugins/product-name/core";

// Did a fix remove its problem as a class, or patch one instance? A push
// naming a report it fixes (`Fixes-report:`, stamped by `./equin push
// --fixes-report`) declares how far it stops the next occurrence (`Fix-level:`,
// required beside it). A push from before the level existed declares none; for
// those the cheapest honest reading git gives stands in: it landed a guard if
// it ALSO changed a lint rule or a check (a file under a `lint/` or `check/`
// folder, tests aside) — a FLOOR, since a type-level guard or a loud runtime
// assert leaves no such trace in the paths.

const TIMEOUT_MS = 60_000;
const MARK = "@@";

/**
 * One fix as it landed: a push to main whose commits name a report they fix.
 * `./equin push --fixes-report` stamps its trailers on every commit of the
 * push, so the push — not each commit — is the unit.
 */
export interface FixCommit {
  /** The push's newest commit's committer time, epoch ms. */
  at: number;
  /** Its declared level; null for a push from before the level was required. */
  level: FixLevel | null;
  /** Whether any of its commits changed a lint rule or a check. */
  guard: boolean;
}

const GUARD_PATH = /(^|\/)(lint|check)\//;
const TEST_PATH = /(\.test\.[cm]?[jt]sx?$)|(\/__tests__\/)|(\/testing\/)/;

/** Whether a changed path is a lint rule or a check (not their tests). */
export function isGuardPath(path: string): boolean {
  return GUARD_PATH.test(path) && !TEST_PATH.test(path);
}

/** The git log `--format` {@link parseFixLog} reads: tab-separated fields. */
export const FIX_LOG_FORMAT =
  `${MARK}%H%x09%ct%x09` +
  `%(trailers:key=${LEGACY_IDS.pushTrailer},valueonly,separator=)%x09` +
  `%(trailers:key=${FIX_LEVEL_TRAILER},valueonly,separator=)`;

/**
 * Parse `git log --format=FIX_LOG_FORMAT --name-only` output into one fix per
 * push (a commit with no push trailer is its own). A level that is not one of
 * `FIX_LEVELS` is thrown on: push validates it, so one on main is a broken
 * assumption.
 */
export function parseFixLog(out: string): FixCommit[] {
  const pushes = new Map<string, FixCommit>();
  let current: FixCommit | null = null;
  for (const line of out.split("\n")) {
    if (line.startsWith(MARK)) {
      const [sha = "", ct, push, rawLevel = ""] = line
        .slice(MARK.length)
        .split("\t");
      const key = push && push.trim().length > 0 ? push.trim() : sha;
      const at = Number(ct) * 1000;
      let level: FixLevel | null = null;
      if (rawLevel.trim() !== "") {
        level = fixLevelOf(rawLevel);
        if (level === null) {
          throw new Error(
            `commit ${sha.slice(0, 12)} names "${rawLevel.trim()}" in its ${FIX_LEVEL_TRAILER} trailer, which is not a fix level`,
          );
        }
      }
      current = pushes.get(key) ?? { at, level, guard: false };
      current.at = Math.max(current.at, at);
      current.level ??= level;
      pushes.set(key, current);
    } else if (current && line.trim() !== "" && isGuardPath(line.trim())) {
      current.guard = true;
    }
  }
  return [...pushes.values()];
}

/**
 * Every fix push on main since `sinceMs`. A `Report-fixed-by:` claim (an older
 * commit claimed later) is not counted: its fix landed before it was named.
 */
export async function readFixCommits(sinceMs: number): Promise<FixCommit[]> {
  const root = await ensureMainWorktreeRoot();
  const { stdout } = await spawnExpectOk(
    [
      GIT,
      "-C",
      root,
      "log",
      "main",
      `--since=${new Date(sinceMs).toISOString()}`,
      "--regexp-ignore-case",
      `--grep=^${FIXES_REPORT_TRAILER}:`,
      `--format=${FIX_LOG_FORMAT}`,
      "--name-only",
    ],
    { timeoutMs: TIMEOUT_MS },
  );
  return parseFixLog(stdout);
}
