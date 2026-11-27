import type {
  DotMerge,
  HealthLevel,
  HealthMark,
  HealthMerge,
  HealthStatus,
  RowLevel,
} from "./types";

/**
 * Severity rank, worst first. `unknown` outranks `info` and `ok` so the
 * merged dot can never claim a known state before every row has vouched for
 * itself; `info` outranks `ok` so something worth knowing (a new version
 * waiting, a deploy under way) turns the dot blue, never hidden in green. `not-applicable`
 * ranks only rows (last); the merge never folds it.
 */
const RANK: Record<RowLevel, number> = {
  critical: 0,
  attention: 1,
  unknown: 2,
  info: 3,
  ok: 4,
  "not-applicable": 5,
  absent: 6,
};

/** `undefined` = a registered status row whose probe has not reported yet. */
export type ReportedStatus = HealthStatus | undefined;

/** The level one reported status stands for: an unreported row is `unknown`. */
export function levelOf(status: ReportedStatus): RowLevel {
  return status === undefined ? "unknown" : status.state;
}

/**
 * True when the status is "not known yet": unreported, or `unknown` without a
 * summary. An `unknown` WITH a summary is known to be unreadable — a different
 * claim, rendered still rather than pulsing.
 */
export function isPending(status: ReportedStatus): boolean {
  return (
    status === undefined ||
    (status.state === "unknown" && status.summary === undefined)
  );
}

/** True when the status is a known state on its way to another (`transitioning`). */
export function isTransitioning(status: ReportedStatus): boolean {
  return (
    status !== undefined &&
    status.state !== "unknown" &&
    status.state !== "not-applicable" &&
    status.state !== "absent" &&
    status.transitioning === true
  );
}

/** True when the status pulses: not known yet, or on its way to another state. */
export function isPulsing(status: ReportedStatus): boolean {
  return isPending(status) || isTransitioning(status);
}

/**
 * Fold every status row's status into what the dot shows.
 *
 * Precedence `critical > attention > unknown > info > ok`; `info` never
 * counts (it is not a problem). Zero rows is `ok`: with
 * nothing registered there is nothing that could be wrong, and nothing pending.
 * A `not-applicable` or `absent` row is left out, as if it were not registered.
 */
export function mergeHealth(
  statuses: ReadonlyArray<ReportedStatus>,
): HealthMerge {
  const { state, count, transitioning, pending } = fold(statuses, false);
  return { state, count, transitioning, pending };
}

/**
 * What the action bar's dot shows: `mergeHealth`, except that an ambient
 * attention row (`HealthStatus.ambient`) folds as `ok` — it neither colours
 * the dot nor counts — and contributes its marks instead. The report's own
 * header's dot is this one too, so the two never disagree; the condition
 * itself is shown as it is in its own row, and the verdict still names it.
 */
export function mergeDot(statuses: ReadonlyArray<ReportedStatus>): DotMerge {
  return fold(statuses, true);
}

function fold(
  statuses: ReadonlyArray<ReportedStatus>,
  quietAmbient: boolean,
): DotMerge {
  let state: HealthLevel = "ok";
  let count = 0;
  let transitioning = false;
  let pending = false;
  const marks: HealthMark[] = [];
  for (const status of statuses) {
    const ambient = status?.state === "attention" ? status.ambient : undefined;
    if (quietAmbient && ambient !== undefined) {
      marks.push(...ambient);
      continue;
    }
    const level = levelOf(status);
    if (level === "not-applicable" || level === "absent") continue;
    if (RANK[level] < RANK[state]) state = level;
    if (level === "attention" || level === "critical") count++;
    if (isPending(status)) pending = true;
    if (isTransitioning(status)) transitioning = true;
  }
  return { state, count, transitioning, pending, marks };
}

/**
 * The report's one-line verdict — the header of the report, and the button's
 * tooltip and accessible name.
 *
 * - `ok` → "All systems normal"
 * - `info`: exactly one informative row → its own words (its state's `title`,
 *   else its summary); more → "N things to know"
 * - some row needs attention: exactly one → that row's own summary (its
 *   state's `title`, when it carries one); more → "N things need attention"
 * - `unknown` while some row is not known yet → "Checking…"
 * - `unknown` where every unknown row said why → its reason, or
 *   "N checks can't be read right now"
 *
 * `not-applicable` and `absent` rows are left out, as in the merge.
 */
export function verdictOf(statuses: ReadonlyArray<ReportedStatus>): string {
  const merged = mergeHealth(statuses);
  switch (merged.state) {
    case "ok":
      return "All systems normal";
    case "info": {
      const informative = statuses.filter((s) => levelOf(s) === "info");
      const only = informative.length === 1 ? informative[0] : undefined;
      const words = only === undefined ? undefined : wordsOf(only);
      return words ?? `${informative.length} things to know`;
    }
    case "unknown": {
      if (merged.pending) return "Checking…";
      const unreadable = statuses.filter((s) => levelOf(s) === "unknown");
      const only = unreadable.length === 1 ? unreadable[0] : undefined;
      if (only?.summary !== undefined) return only.summary;
      return `${unreadable.length} checks can't be read right now`;
    }
    case "attention":
    case "critical": {
      if (merged.count > 1) return `${merged.count} things need attention`;
      const only = statuses.find((s) => {
        const level = levelOf(s);
        return level === "attention" || level === "critical";
      });
      // `count === 1` guarantees a match; the fallback only satisfies the type.
      const words = only === undefined ? undefined : wordsOf(only);
      return words ?? "1 thing needs attention";
    }
  }
}

/** A row's own words for the verdict: a row whose state names itself says its title, else its summary. */
function wordsOf(status: HealthStatus): string | undefined {
  return ("title" in status ? status.title : undefined) ?? status.summary;
}

/**
 * True when a row must be in view whatever the layout says: it needs a look
 * (`attention` / `critical`), is worth knowing (`info`), or is known to be
 * unreadable (`unknown` with a summary) — everything that moves the dot off
 * green. A row that is fine, does not apply, has nothing to say, or is not
 * known yet (the header says "Checking…") may stay tucked away.
 */
export function standsOut(status: ReportedStatus): boolean {
  if (status === undefined) return false;
  switch (status.state) {
    case "attention":
    case "critical":
    case "info":
      return true;
    case "unknown":
      return status.summary !== undefined;
    case "ok":
    case "not-applicable":
    case "absent":
      return false;
  }
}

/**
 * The report's two lists, from its rows in the slot's layout order, each
 * marked `overflow` when the layout puts it in the slot's overflow:
 *
 * - `shown` — every row outside the overflow, in layout order; then every
 *   overflow row that {@link standsOut}, in layout order — so a problem is
 *   never behind the chevron, and it surfaces at the end of the list rather
 *   than pushing the rows the user placed;
 * - `tucked` — the other overflow rows, in layout order: behind the chevron.
 *
 * Deliberately blind to status beyond that: a row keeps its place whatever it
 * reports, so the report does not reshuffle when something turns red.
 */
export function placeRows<R>(
  rows: ReadonlyArray<{ row: R; overflow: boolean }>,
  statusOf: (row: R) => ReportedStatus,
): { shown: R[]; tucked: R[] } {
  const inline: R[] = [];
  const surfaced: R[] = [];
  const tucked: R[] = [];
  for (const { row, overflow } of rows) {
    if (!overflow) inline.push(row);
    else if (standsOut(statusOf(row))) surfaced.push(row);
    else tucked.push(row);
  }
  return { shown: [...inline, ...surfaced], tucked };
}
