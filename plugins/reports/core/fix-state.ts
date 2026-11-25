/**
 * Where a report stands against its fix, derived from facts — never set by
 * hand (research/2026-11-08-reports-fix-state-and-regressions.md):
 *
 * - `open` — no commit on main names it (`Fixes-report:`), and none claims
 *   an earlier one fixed it (`Report-fixed-by:`);
 * - `pending` — a commit on main is its fix, and main does not run it yet;
 * - `fixed` — main runs the fix, and nothing fired since from code that has it;
 * - `regressed` — it fired again from code that has the fix (or from code that
 *   could not name its commit, once the fix was live).
 *
 * An occurrence from code WITHOUT the fix (a worktree behind main) is no
 * evidence either way and changes nothing.
 */
export const REPORT_FIX_STATES = [
  "open",
  "pending",
  "fixed",
  "regressed",
] as const;
export type ReportFixState = (typeof REPORT_FIX_STATES)[number];

/** Each state as a reader sees it. */
export const REPORT_FIX_STATE_LABELS = {
  open: "Open",
  pending: "Fix pending",
  fixed: "Fixed",
  regressed: "Regressed",
} as const satisfies Record<ReportFixState, string>;

/**
 * The trailer a fixing commit names its report with. `./equin push
 * --fixes-report <id>` is its one writer; main's ledger reads it back.
 */
export const FIXES_REPORT_TRAILER = "Fixes-report";

/**
 * How far a fix stops the NEXT occurrence of the same kind of bug, in the
 * order of the root CLAUDE.md "Fix the cause" ladder (highest rung first).
 * Named for what the fix achieves, not the tool it used:
 *
 * - `designed-away` — the API no longer has a way to write the mistake;
 * - `refused-before-landing` — a type error, lint rule or check rejects it;
 * - `caught-at-runtime` — a loud assert fails when it happens;
 * - `documented` — only written down;
 * - `one-off` — only this occurrence is fixed.
 *
 * A closed set, one per push: `./equin push --fixes-report` requires
 * `--fix-level <level>` and stamps it as {@link FIX_LEVEL_TRAILER}.
 */
export const FIX_LEVELS = [
  "designed-away",
  "refused-before-landing",
  "caught-at-runtime",
  "documented",
  "one-off",
] as const;
export type FixLevel = (typeof FIX_LEVELS)[number];

/** Each level as a reader sees it. */
export const FIX_LEVEL_LABELS = {
  "designed-away": "Designed away",
  "refused-before-landing": "Refused before landing",
  "caught-at-runtime": "Caught at runtime",
  documented: "Documented",
  "one-off": "One-off",
} as const satisfies Record<FixLevel, string>;

/** What each level means, for help text and the scoreboard's legend. */
export const FIX_LEVEL_MEANINGS = {
  "designed-away": "the API no longer has a way to write the mistake",
  "refused-before-landing": "a type error, lint rule or check rejects it",
  "caught-at-runtime": "a loud assert fails when it happens",
  documented: "only written down",
  "one-off": "only this occurrence is fixed",
} as const satisfies Record<FixLevel, string>;

/** The levels that stop the next occurrence before it can land: structural. */
export const STRUCTURAL_FIX_LEVELS = [
  "designed-away",
  "refused-before-landing",
] as const satisfies readonly FixLevel[];

/** `value` as a fix level, or null when it is not one. */
export function fixLevelOf(value: string): FixLevel | null {
  const v = value.trim();
  return (FIX_LEVELS as readonly string[]).includes(v) ? (v as FixLevel) : null;
}

/**
 * The trailer a `Fixes-report` push declares its {@link FixLevel} with —
 * stamped beside it on every commit of the push by `./equin push
 * --fix-level`, its one writer; the scoreboard reads it back.
 */
export const FIX_LEVEL_TRAILER = "Fix-level";

/**
 * The trailer a push claims an EARLIER commit on main fixed a report with —
 * the fix that landed without naming it, which history cannot be rewritten to
 * name. Its values are `<report id>@<full sha>` ({@link fixedByClaim}); the
 * fix is that commit, judged exactly like one named by `Fixes-report` (live
 * once main runs code containing it, regressed once the report fires from such
 * code). `./equin push --report-fixed-by <id>@<sha>` is its one writer.
 *
 * A key of its own, not a value form of `Fixes-report`: the two say different
 * things ("this push fixes it" / "that commit fixed it"), and a reader that
 * knows only `Fixes-report` never sees one it would misread.
 */
export const REPORT_FIXED_BY_TRAILER = "Report-fixed-by";

const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * One `Report-fixed-by` value as `{ reportId, commit }`, or null when it is
 * not `<report id>@<40-hex sha>` — the one grammar its writer and its reader
 * share.
 */
export function fixedByClaim(
  value: string,
): { reportId: string; commit: string } | null {
  const at = value.lastIndexOf("@");
  if (at <= 0) return null;
  const reportId = value.slice(0, at).trim();
  const commit = value.slice(at + 1).trim();
  return FULL_SHA.test(commit) ? { reportId, commit } : null;
}

/** One fix of a report, as the ledger (`report_fixes`) holds it. */
export interface ReportFixFacts {
  /**
   * The fixing commit: the newest commit of its push naming the report, or
   * the earlier commit a `Report-fixed-by` claim names.
   */
  commit: string;
  /** When the claim reached main (for a `Report-fixed-by` one, the claim's push). */
  landedAt: Date;
  /** When main first ran code containing it; null while it does not. */
  deployedAt: Date | null;
  /** The first occurrence from code containing it; null while there is none. */
  regressedAt: Date | null;
}

/** A report's derived fix state, and since when it holds. */
export interface ReportFixStanding {
  fixState: ReportFixState;
  fixCommit: string | null;
  fixStateAt: Date | null;
}

/** The standing of a report whose latest fix is `latest` (null: none). */
export function fixStandingOf(
  latest: ReportFixFacts | null,
): ReportFixStanding {
  if (latest === null) {
    return { fixState: "open", fixCommit: null, fixStateAt: null };
  }
  const { commit } = latest;
  if (latest.regressedAt !== null) {
    return {
      fixState: "regressed",
      fixCommit: commit,
      fixStateAt: latest.regressedAt,
    };
  }
  if (latest.deployedAt !== null) {
    return {
      fixState: "fixed",
      fixCommit: commit,
      fixStateAt: latest.deployedAt,
    };
  }
  return {
    fixState: "pending",
    fixCommit: commit,
    fixStateAt: latest.landedAt,
  };
}

/**
 * Whether an occurrence regresses an unregressed fix. `contains` is whether
 * the occurrence's code descends from the fix commit (`null`: the occurrence
 * could not name its commit, or the commit is not one of this repository).
 * Unknown code counts once the fix is live — "cannot tell" never keeps a
 * report quietly fixed — but not before: then the code most likely predates
 * the fix.
 */
export function regresses(
  fix: Pick<ReportFixFacts, "deployedAt">,
  contains: boolean | null,
): boolean {
  if (contains === null) return fix.deployedAt !== null;
  return contains;
}
