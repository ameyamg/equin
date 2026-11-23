import type { RecordedVerdict, VerdictIndex } from "./verdicts";

/**
 * Every test file whose digest moved between the merge base and HEAD — the
 * files the change can affect: its closure, its runner's inputs or the npm
 * resolutions changed, or it is new. A file gone at HEAD is nobody's test.
 * Sorted.
 */
export function affectedTests(
  head: ReadonlyMap<string, string>,
  base: ReadonlyMap<string, string>,
): string[] {
  return [...head]
    .filter(([path, digest]) => base.get(path) !== digest)
    .map(([path]) => path)
    .sort();
}

/**
 * A pass that proves the code at its digest: it ran at least one case. A file
 * whose every case skipped (a platform or env `skipIf`) passes having
 * verified nothing.
 */
export function isProvingPass(v: RecordedVerdict): boolean {
  return v.outcome === "passed" && v.cases > 0;
}

/**
 * Whether a file that fails at HEAD is this change's doing. Judged per FILE: a
 * file already failing on main witnesses nothing, whichever of its cases fail
 * (a nondeterministic suite fails a different handful each run — see
 * `infra/deps/updates`' baseline comparison). Cases failing at HEAD that the
 * evidence never saw fail are surfaced as `newCases`, a warning.
 */
export type FailureJudgement =
  | {
      kind: "new";
      reason:
        | "new-file" // no such test at the merge base
        | "passed-at-base" // it passed at the merge base's code
        | "passing-on-main" // no verdict at the merge base; main last saw it pass
        | "no-evidence"; // no verdict at the merge base, none on main
      evidence: readonly RecordedVerdict[];
    }
  | {
      kind: "pre-existing";
      reason:
        | "failed-at-base" // it failed at the merge base's code
        | "failing-on-main"; // no verdict at the merge base; main last saw it fail
      evidence: readonly RecordedVerdict[];
      /** Cases failing at HEAD that no evidence run saw fail. */
      newCases: readonly string[];
    };

/**
 * Only a run that loaded the file says anything about it: `not-loaded` is
 * what an interrupted or crashed runner leaves for every file it did not
 * reach, so it is no evidence either way.
 */
const conclusive = (vs: readonly RecordedVerdict[]): RecordedVerdict[] =>
  vs.filter((v) => v.outcome !== "not-loaded");

function newCasesOf(
  headFailedCaseIds: readonly string[],
  evidence: readonly RecordedVerdict[],
): string[] {
  const seen = new Set(evidence.flatMap((v) => v.failedCaseIds));
  return headFailedCaseIds.filter((c) => !seen.has(c));
}

/**
 * The evidence ladder for one failing file:
 *
 * 1. its verdicts at the merge base's digest — exactly the code this change
 *    started from, from any checkout — by majority, so one flaky run cannot
 *    outvote the rest (a tie counts as failing: the base is not known green);
 * 2. else main's own newest verdict for the file, at any digest (its idle
 *    runner's) — main's code moves, so the newest one speaks for it.
 */
export function judgeFailure(
  path: string,
  baseDigest: string | undefined,
  headFailedCaseIds: readonly string[],
  index: VerdictIndex,
): FailureJudgement {
  if (baseDigest === undefined)
    return { kind: "new", reason: "new-file", evidence: [] };
  const atBase = conclusive(index.at(path, baseDigest));
  if (atBase.length > 0) {
    const failed = atBase.filter((v) => v.outcome === "failed");
    return failed.length * 2 >= atBase.length
      ? {
          kind: "pre-existing",
          reason: "failed-at-base",
          evidence: failed,
          newCases: newCasesOf(headFailedCaseIds, failed),
        }
      : { kind: "new", reason: "passed-at-base", evidence: atBase };
  }
  const onMain = conclusive(index.onMain(path))[0];
  if (onMain === undefined)
    return { kind: "new", reason: "no-evidence", evidence: [] };
  return onMain.outcome === "failed"
    ? {
        kind: "pre-existing",
        reason: "failing-on-main",
        evidence: [onMain],
        newCases: newCasesOf(headFailedCaseIds, [onMain]),
      }
    : { kind: "new", reason: "passing-on-main", evidence: [onMain] };
}

/**
 * Whether a judgement rests on exactly the code the change started from: the
 * file is new, or verdicts at its merge-base digest decided it. Main's own
 * newest verdict is about whatever digest main last ran the file at, often
 * days and many commits away from the merge base: it neither proves the base
 * green (a breakage landed since would read as this change's) nor red (a fix
 * landed since would wave a real breakage through). The gate establishes a
 * merge-base verdict for every judgement that does not rest on one.
 */
export function restsOnMergeBase(j: FailureJudgement): boolean {
  return (
    j.reason === "new-file" ||
    j.reason === "passed-at-base" ||
    j.reason === "failed-at-base"
  );
}

function stamp(v: RecordedVerdict): string {
  return `${v.startedAt.slice(0, 16).replace("T", " ")} UTC, ${v.slug}`;
}

/** Why a failing file was judged the way it was, one line. */
export function describeJudgement(j: FailureJudgement): string {
  const newest = j.evidence[0];
  const when = newest === undefined ? "" : ` (${stamp(newest)})`;
  switch (j.reason) {
    case "new-file":
      return "a new test file — it does not exist at the merge base (a renamed file counts as new)";
    case "passed-at-base": {
      const passed = j.evidence.filter((v) => v.outcome === "passed").length;
      return `passed at the merge base's code — ${passed} of ${j.evidence.length} recorded runs${when}`;
    }
    case "passing-on-main":
      return `no verdict at the merge base's code; main's own last run of it passed${when} — if main fixed it since, rebase onto main`;
    case "no-evidence":
      return "no verdict at the merge base's code, and main never ran it";
    case "failed-at-base":
      return `already failing at the merge base's code — ${j.evidence.length} recorded failing run(s)${when}`;
    case "failing-on-main":
      return `already failing on main${when}`;
  }
}
