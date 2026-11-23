import {
  awakeBetween,
  unstampedInstant,
  type ClockStamp,
} from "@plugins/packages/plugins/sleep-clock/plugins/stamp/core";
import { LAUNCH_SEGMENTS, type LaunchInstant } from "./phases";
import type { CheckoutSourceKind, CheckoutStep, LaunchMarks } from "./schemas";

/** What the stats read of one launch (a `LaunchRecord` is one). */
export interface LaunchSample {
  requestedAt: Date;
  marks: LaunchMarks;
  checkoutSteps: readonly CheckoutStep[];
  checkoutSource: CheckoutSourceKind | null;
}

export interface Percentiles {
  n: number;
  /** Null when no launch has the stretch. */
  p50: number | null;
  p90: number | null;
}

/**
 * One stretch's AWAKE-time percentiles, and how many of its launches the
 * machine slept through (the sleep taken out) or could not tell (wall time).
 */
export interface SegmentStats extends Percentiles {
  id: string;
  label: string;
  total: boolean;
  /** Launches whose stretch spanned a sleep — taken out of their value. */
  slept: number;
  /**
   * Launches whose stretch's sleep cannot be told (a record from before
   * stamps, a reboot in between): their value is the wall span.
   */
  untold: number;
}

/** Nearest-rank percentile of `sorted` (ascending), `q` in (0, 1]. */
function nearestRank(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(q * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export function percentiles(values: readonly number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: nearestRank(sorted, 0.5),
    p90: nearestRank(sorted, 0.9),
  };
}

/**
 * The stamp of instant `at` of a launch; undefined when not reached. A record
 * opened before the request was stamped has only its wall instant.
 */
export function instantOf(
  launch: LaunchSample,
  at: LaunchInstant,
): ClockStamp | undefined {
  if (at === "requested")
    return (
      launch.marks.requested ?? unstampedInstant(launch.requestedAt.getTime())
    );
  return launch.marks[at];
}

/**
 * Each segment's AWAKE duration (ms) over the launches that reached both its
 * ends — a launch still in flight, or one that skipped a phase (a scratch
 * workspace has no checkout), counts only in the segments it has. The
 * machine's sleep inside a stretch is taken out (`awakeBetween`): a laptop
 * that naps mid-launch spent the nap launching nothing.
 */
export function segmentStats(
  launches: readonly LaunchSample[],
): SegmentStats[] {
  return LAUNCH_SEGMENTS.map((seg) => {
    const values: number[] = [];
    let slept = 0;
    let untold = 0;
    for (const l of launches) {
      const from = instantOf(l, seg.from);
      const to = instantOf(l, seg.to);
      if (from === undefined || to === undefined) continue;
      const span = awakeBetween(from, to);
      values.push(span.awakeMs);
      if (span.sleptMs === null) untold += 1;
      // The two raw clocks are read apart: a sub-ms difference is jitter.
      else if (span.sleptMs >= 1) slept += 1;
    }
    return {
      id: seg.id,
      label: seg.label,
      total: seg.total === true,
      slept,
      untold,
      ...percentiles(values),
    };
  });
}

/**
 * Each checkout step's duration over the launches whose checkout ran it — a
 * step a checkout ran twice counts its sum.
 */
export function checkoutStepStats(
  launches: readonly LaunchSample[],
): (Percentiles & { step: string })[] {
  const byStep = new Map<string, number[]>();
  for (const l of launches) {
    const sums = new Map<string, number>();
    for (const s of l.checkoutSteps)
      sums.set(s.step, (sums.get(s.step) ?? 0) + s.ms);
    for (const [step, ms] of sums) {
      const list = byStep.get(step) ?? [];
      list.push(ms);
      byStep.set(step, list);
    }
  }
  return [...byStep].map(([step, values]) => ({
    step,
    ...percentiles(values),
  }));
}
