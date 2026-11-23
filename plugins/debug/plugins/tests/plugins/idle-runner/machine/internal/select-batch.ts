import type {
  TestOutcome,
  TestStatus,
} from "@plugins/debug/plugins/tests/core";

/** What the selection reads of one file's status row. */
export interface BatchCandidate {
  path: string;
  /** The file's current digest: a file is taken at most twice per digest. */
  digest: string;
  status: TestStatus;
  lastOutcome: TestOutcome | null;
  lastRanAt: Date | null;
  /** The last known run's duration; `null` for a file never run. */
  durationMs: number | null;
  /** Results on the current digest, any checkout's / this checkout's own. */
  currentPassed: number;
  currentFailed: number;
  ownPassed: number;
  ownFailed: number;
}

/** A batch stops once its files' last-known durations add up to this... */
export const IDLE_BATCH_BUDGET_MS = 60_000;
/** ...or at this many files. */
export const IDLE_BATCH_MAX_FILES = 25;
/** What a file with no known duration is counted as. */
export const UNKNOWN_DURATION_MS = 2_000;
const ranAt = (c: BatchCandidate): number => c.lastRanAt?.getTime() ?? 0;
const oldestFirst = (a: BatchCandidate, b: BatchCandidate): number =>
  ranAt(a) - ranAt(b) || a.path.localeCompare(b.path);

/** Main's own runs failed it once on this code, and no run passed it: run it again before believing it. */
export const toConfirm = (c: BatchCandidate): boolean =>
  c.ownFailed === 1 && c.ownPassed === 0 && c.currentPassed === 0;

/** Another checkout's run failed it on THIS code (an agent's run of main's code), and this checkout has no verdict of its own: verify it here. */
export const seenFailingElsewhere = (c: BatchCandidate): boolean =>
  c.currentFailed > 0 && c.ownPassed === 0 && c.ownFailed === 0;

/**
 * The files this checkout owes a verdict on its current code, most useful
 * first. Derived from the status rows alone (no process memory: main restarts
 * on every push, and a queue kept in memory was lost each time):
 *
 * 1. to confirm — one failure of this checkout's own on the current code and
 *    no pass: a failure is believed only once a second run repeats it
 *    (failing-report);
 * 2. seen failing elsewhere — another checkout failed it on this very code;
 * 3. stale and last failing — the likeliest to have been fixed (or to still be
 *    broken) by the change that moved their digest;
 * 4. never run;
 * 5. stale, oldest run first.
 */
export function duePool(
  candidates: readonly BatchCandidate[],
): BatchCandidate[] {
  const stale = candidates.filter((c) => c.status === "stale");
  const lastFailing = (c: BatchCandidate) =>
    c.lastOutcome !== null && c.lastOutcome !== "passed";
  const ordered = [
    ...candidates.filter(toConfirm).sort(oldestFirst),
    ...candidates
      .filter((c) => !toConfirm(c) && seenFailingElsewhere(c))
      .sort(oldestFirst),
    ...stale.filter(lastFailing).sort(oldestFirst),
    ...candidates
      .filter((c) => c.status === "never")
      .sort((a, b) => a.path.localeCompare(b.path)),
    ...stale.filter((c) => !lastFailing(c)).sort(oldestFirst),
  ];
  const seen = new Set<string>();
  return ordered.filter((c) => !seen.has(c.path) && seen.add(c.path));
}

/**
 * The next batch: the due files, most useful first, until
 * {@link IDLE_BATCH_MAX_FILES} files or their last-known durations reach
 * {@link IDLE_BATCH_BUDGET_MS} (a file is taken whole, so the first always
 * is): a cancelled batch loses little. Null when nothing is owed.
 *
 * There is no other pool: a verdict main already has on its current code is
 * never re-run for its age — the code has not changed (a fix moves the
 * file's digest, so it runs as due), and a re-run of a failing file would
 * re-ring its report's bell.
 */
export function selectDueBatch(
  candidates: readonly BatchCandidate[],
): string[] | null {
  const paths: string[] = [];
  let budget = 0;
  for (const c of duePool(candidates)) {
    if (paths.length >= IDLE_BATCH_MAX_FILES || budget >= IDLE_BATCH_BUDGET_MS)
      break;
    paths.push(c.path);
    budget += c.durationMs ?? UNKNOWN_DURATION_MS;
  }
  return paths.length === 0 ? null : paths;
}
