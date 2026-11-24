import { z } from "zod";
import { PER_UNIT_BYTES } from "@plugins/infra/plugins/host/plugins/host-admission/core";

// Whether a plain `./equin run` script is HEAVY — and so takes a share of the
// host `cpu` pool before it starts, like a check — decided from what that one
// script was measured to use, never declared and never assumed.
//
// A script is an arbitrary program: on this host ~98 % of runs stay far under
// one quantum and must start at once (a one-off data script must not queue
// behind builds), while ~2 % build a whole-repo TypeScript program and hold
// 4–20 GB for minutes. Unadmitted, those were alive 1.4 % of the time and in
// 38 % of the host's memory-pressure episodes (2026-11-06 → 11-24,
// research/2026-11-24-global-heavy-script-memory-admission.md). Nothing says
// which is which before a script has run — so every run's peak is recorded,
// and a script whose own recent runs were heavy is admitted from then on.

/** One finished script run, as the ledger keeps it. */
export const ScriptPeakRecordSchema = z.object({
  /** When the run ended (ISO). */
  t: z.string(),
  /** The script: its repo-relative path, or a scratch script's absolute path. */
  script: z.string(),
  /** Its process's lifetime peak physical footprint, as the kernel charged it. */
  peakBytes: z.number().nonnegative(),
});
export type ScriptPeakRecord = z.infer<typeof ScriptPeakRecordSchema>;

/** How far back a run still describes the script. */
export const SCRIPT_PEAK_WINDOW_MS = 14 * 24 * 3600 * 1000;

/**
 * How many of a script's latest runs its weight is the LARGEST of. One heavy
 * run is enough — unlike a holder work's reservation (`holderReserve`, never
 * one record alone), a single run here only decides whether THIS script
 * queues, and missing a heavy one costs the host more than admitting a light
 * one costs the script. A script that turns light again (other arguments, a
 * fix) is unadmitted after this many light runs.
 */
export const SCRIPT_WEIGHT_RUNS = 5;

/** What `./equin run` does about a script's memory before it starts it. */
export type ScriptWeight =
  | { kind: "light" }
  | {
      kind: "heavy";
      /** The recent peak that makes it heavy. */
      peakBytes: number;
      /** `cpu` units its share takes: its peak in quanta, within the lane. */
      units: number;
      /**
       * What its share is reserved: its peak, never above its units' quanta.
       * One outlier run (other arguments, a runaway: 55 GB) would otherwise
       * be every later run's reservation for five runs and close the window
       * for every other op; beyond this the holder is charged what it is
       * measured at, like any holder.
       */
      reserveBytes: number;
    };

/**
 * The weight of a script from its own recorded peaks (`peaks`: inside the
 * window, oldest first). Heavy from one quantum (`PER_UNIT_BYTES`) up — the
 * pool's own unit, one type-check-class worker: below it a script is lighter
 * than the lightest thing the pool counts. `maxUnits` is the lane's static
 * window (`cpuBudget().backgroundLimit`): a share above it could never be
 * granted, so a script heavier than the lane is admitted as the whole lane.
 */
export function scriptWeight(
  peaks: readonly number[],
  maxUnits: number,
): ScriptWeight {
  const peakBytes = Math.max(0, ...peaks.slice(-SCRIPT_WEIGHT_RUNS));
  if (peakBytes < PER_UNIT_BYTES) return { kind: "light" };
  const units = Math.max(
    1,
    Math.min(maxUnits, Math.ceil(peakBytes / PER_UNIT_BYTES)),
  );
  return {
    kind: "heavy",
    peakBytes,
    units,
    reserveBytes: Math.min(peakBytes, units * PER_UNIT_BYTES),
  };
}

/** `script`'s recorded peaks inside the window ending at `nowMs`, oldest first. */
export function peaksOfScript(
  records: readonly ScriptPeakRecord[],
  script: string,
  nowMs: number,
): number[] {
  return records
    .filter(
      (r) =>
        r.script === script && nowMs - Date.parse(r.t) <= SCRIPT_PEAK_WINDOW_MS,
    )
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
    .map((r) => r.peakBytes);
}
