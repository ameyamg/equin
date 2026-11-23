import { CLI_NAME } from "@plugins/framework/plugins/cli/plugins/cli-name/core";
import { commitSnapshot } from "@plugins/framework/plugins/tooling/core";
import type { AppPath } from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import {
  MAIN_COMPOSITION_ID,
  namespaceFor,
} from "@plugins/infra/plugins/namespace/core";
import { spawnCaptured } from "@plugins/infra/plugins/spawn/core";
import { openRecordStore } from "@plugins/plugin-meta/plugins/plugin-records/cli";
import {
  testDigests,
  testFilesOf,
} from "@plugins/framework/plugins/cli/plugins/test/plugins/digest/core";
import {
  readKnownTestReports,
  type KnownTestReport,
} from "@plugins/debug/plugins/tests/plugins/failing-report/cli";
import {
  buildVerdictIndex,
  describeJudgement,
  judgeFailure,
  type FailureJudgement,
  type VerdictIndex,
} from "../../core";
import { readTestRunRecords } from "./records";

// A wedge-breaker for one metadata read, not a latency budget.
const GIT_TIMEOUT_MS = 30_000;

/** Main's namespace: the slug its own runs (its idle runner's) are recorded under. */
export function mainSlug(): string {
  return namespaceFor(MAIN_COMPOSITION_ID, { kind: "main" });
}

/** Every harvested verdict on this host, indexed for the judgement. */
export async function readVerdictIndex(): Promise<VerdictIndex> {
  return buildVerdictIndex(await readTestRunRecords(), mainSlug());
}

/** One file that failed, as the caller's run saw it. */
export interface FailingFile {
  path: string;
  /** Its failing case ids (`<suite> > … > <case>`), for the new-case warning. */
  failedCaseIds: readonly string[];
}

/** Where one failing file stands on main. */
export interface Standing {
  path: string;
  judgement: FailureJudgement;
  /** Main's `test-failing` report about the file, when it has one. */
  report: KnownTestReport | null;
}

export interface StandingResult {
  standings: Standing[];
  /** Why main's reports could not be read (the judgements stand without them). */
  reportsError: string | null;
}

/**
 * Judge each failing file against main — the ONE notion of "already failing
 * on main" (`judgeFailure`: its verdicts at the merge base's digest, else
 * main's own newest) — and attach main's `test-failing` report about it.
 * `baseDigests`: the merge base's digests when the caller has them (the push
 * gate computes them anyway); else they are computed here for just these
 * files.
 */
export async function standingOnMain(
  root: AppPath,
  failing: readonly FailingFile[],
  opts: {
    index?: VerdictIndex;
    baseDigests?: ReadonlyMap<string, string>;
  } = {},
): Promise<StandingResult> {
  if (failing.length === 0) return { standings: [], reportsError: null };
  const paths = failing.map((f) => f.path);
  const [index, base] = await Promise.all([
    opts.index ?? readVerdictIndex(),
    opts.baseDigests ?? mergeBaseDigests(root, paths),
  ]);
  let reports = new Map<string, KnownTestReport>();
  let reportsError: string | null = null;
  try {
    reports = await readKnownTestReports(paths);
  } catch (err) {
    reportsError = err instanceof Error ? err.message : String(err);
  }
  return {
    standings: failing.map((f) => ({
      path: f.path,
      judgement: judgeFailure(f.path, base.get(f.path), f.failedCaseIds, index),
      report: reports.get(f.path) ?? null,
    })),
    reportsError,
  };
}

/**
 * The test digests of `paths` at the merge base of HEAD with `main`, read
 * from git objects (`commitSnapshot`), never the working tree. A path the
 * merge base does not have is absent (a new test file).
 */
export async function mergeBaseDigests(
  root: AppPath,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const r = await spawnCaptured(["git", "merge-base", "HEAD", "main"], {
    cwd: root,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  if (r.exitCode !== 0)
    throw new Error(
      `main standing: git merge-base HEAD main failed (exit ${r.exitCode}): ${r.stderr.trim()}`,
    );
  const snap = await commitSnapshot(root, r.stdout.trim());
  const atBase = new Set(testFilesOf(snap));
  const store = openRecordStore();
  const digests = await testDigests(
    snap,
    store,
    paths.filter((p) => atBase.has(p)),
  );
  await store.flush();
  return new Map([...digests].map(([path, d]) => [path, d.digest]));
}

function reportLine(r: KnownTestReport): string {
  const owner =
    r.taskId === null ? "no owner task yet" : `owner task ${r.taskId}`;
  return `main's report ${r.reportId} (${r.fixState}, ${owner})`;
}

/**
 * The lines an agent reads under a failing run: per file, whether main
 * already knows it (its report and owner task) and so it is not this
 * change's doing; and what to do about each kind — never file a known
 * failure again.
 */
export function standingLines(result: StandingResult): string[] {
  const { standings, reportsError } = result;
  if (standings.length === 0) return [];
  const known = standings.filter((s) => s.judgement.kind === "pre-existing");
  const yours = standings.filter((s) => s.judgement.kind === "new");
  const lines = ["", "Where these failures stand on main:"];
  if (known.length > 0) {
    lines.push("  Already failing on main — not your change's doing:");
    for (const s of known) {
      lines.push(`    ${s.path}`, `      ${describeJudgement(s.judgement)}`);
      lines.push(
        s.report !== null
          ? `      ${reportLine(s.report)}`
          : "      not reported yet: main's runner verifies it from this run's record and files the report",
      );
    }
  }
  if (yours.length > 0) {
    lines.push("  Not failing on main — most likely this checkout's change:");
    for (const s of yours) {
      lines.push(`    ${s.path}`, `      ${describeJudgement(s.judgement)}`);
      if (s.report !== null) lines.push(`      ${reportLine(s.report)}`);
    }
  }
  if (reportsError !== null)
    lines.push(`  (main's test reports could not be read: ${reportsError})`);
  if (known.length > 0)
    lines.push(
      "",
      "Do NOT file a task about a failure already failing on main: each one has (or gets) exactly one",
      "report and one owner task, and this run is already recorded as evidence. Fix it only if it is in",
      `your way, and land the fix with \`./${CLI_NAME} push --fixes-report <report id>\`.`,
    );
  return lines;
}
