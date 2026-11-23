// Pure delta / rollup math for the op-time trip-wire, extracted from the monitor
// job so the reset-safety and rollup arithmetic are unit-tested in isolation
// (op-time-math.test.ts). The job owns the module-level baseline maps and the
// report emission; this file owns only the number-crunching.

// Reset-safe window delta of a cumulative counter (call count OR totalMs). The
// runtime profiler accumulates both cumulatively since boot; we diff successive
// ticks. Byte-for-byte the same rule the op-rate count diff uses:
//   • First observation (`prev === undefined`) → null: seed the baseline and
//     fire nothing, avoiding a false spike from the full since-boot value.
//   • Reset/regression (`current < prev` — profile was reset, or the label is
//     new this tick) → the full current value as the window delta.
//   • Otherwise → `current - prev`.
export function windowDelta(
  prev: number | undefined,
  current: number,
): number | null {
  if (prev === undefined) return null;
  return current >= prev ? current - prev : current;
}

// One label's ms delta over the window (input to the per-kind rollup).
export interface LabelDelta {
  label: string;
  deltaMs: number;
}

export interface RollupBreach {
  /** Σ per-op ms deltas across the kind's labels this window. */
  sumDeltaMs: number;
  /** The per-kind ms budget × rollupFactor the sum exceeded. */
  rollupBudgetMs: number;
  /** Top-10 contributing labels by ms delta desc. */
  topLabels: LabelDelta[];
}

// Per-kind rollup: catches cost smeared across many labels, each under its own
// per-op budget. Trips when the sum of the kind's per-op ms deltas exceeds
// `budgetMs × rollupFactor`. Returns the breach (with the top-10 contributing
// labels) or null when under budget. Pure — the caller supplies the deltas.
export function computeRollup(
  deltas: LabelDelta[],
  budgetMs: number,
  rollupFactor: number,
): RollupBreach | null {
  const sumDeltaMs = deltas.reduce((acc, d) => acc + d.deltaMs, 0);
  const rollupBudgetMs = budgetMs * rollupFactor;
  if (sumDeltaMs <= rollupBudgetMs) return null;
  const topLabels = [...deltas]
    .sort((a, b) => b.deltaMs - a.deltaMs)
    .slice(0, 10);
  return { sumDeltaMs, rollupBudgetMs, topLabels };
}

// One gate's cumulative wait meter, as the profiler reports it (`GateMeter`).
export interface GateReading {
  layer: string;
  kind: "queue" | "io";
  count: number;
  /** Σ every wait's ms, concurrent waits summed. */
  totalMs: number;
  /** The union of the waits' intervals: wall time at least one was in progress. */
  busyTotalMs: number;
}

// The previous tick's reading of every gate, by layer.
export type GateBaseline = Map<
  string,
  { count: number; totalMs: number; busyTotalMs: number }
>;

export interface GateTrip {
  layer: string;
  kind: "queue" | "io";
  /** The ms the gate is judged on this window (see `judgedMs`). */
  msDelta: number;
  /** Σ every wait's ms this window, concurrent waits summed. */
  summedMsDelta: number;
  /** Waits charged on the gate this window. */
  waitsDelta: number;
}

// What a gate's window is judged on, by what its waiters waited FOR:
//   • `queue` — capacity on a shared gate: each waiter is an op that lost its
//     own wait, so the waits SUM (total time ops lost queued).
//   • `io` — work another party did (a child process, the disk, a worker):
//     concurrent waits are parallel work, so the UNION — the wall time the
//     layer's work was outstanding. A sum would charge a job's four git lanes
//     four times: main's healthy fsmonitor pass at 11:00 UTC on 2026-11-23 ran
//     78 children 4 at a time in 19.7 s of wall and summed 75.9 s, past the
//     60 s budget (report-1795138817-crebd9). The worst overlapping-pass
//     windows of 2026-11-22 had git outstanding 62–117 awake s: still past it.
function judgedMs(
  kind: GateReading["kind"],
  d: { totalMs: number; busyTotalMs: number },
): number {
  return kind === "io" ? d.busyTotalMs : d.totalMs;
}

// The gates whose window, judged by `judgedMs`, is past `budgetMs`, diffing
// each reading against `baseline` (updated in place, so it holds this tick's
// readings for the next). Same rules as `windowDelta`: a gate seen for the
// first time seeds and trips nothing; a reset (its count fell) takes the whole
// reading.
export function gateTrips(
  readings: readonly GateReading[],
  baseline: GateBaseline,
  budgetMs: number,
): GateTrip[] {
  const trips: GateTrip[] = [];
  for (const g of readings) {
    const prev = baseline.get(g.layer);
    baseline.set(g.layer, {
      count: g.count,
      totalMs: g.totalMs,
      busyTotalMs: g.busyTotalMs,
    });
    if (prev === undefined) continue;
    // One reset decision for every field (the count only grows between
    // resets): judged per field, a reset's new union could read as a small
    // gain while its sum is taken whole.
    const reset = g.count < prev.count;
    const delta = (p: number, c: number) => (reset ? c : c - p);
    const totalMs = delta(prev.totalMs, g.totalMs);
    const busyTotalMs = delta(prev.busyTotalMs, g.busyTotalMs);
    const msDelta = judgedMs(g.kind, { totalMs, busyTotalMs });
    if (msDelta <= budgetMs) continue;
    trips.push({
      layer: g.layer,
      kind: g.kind,
      msDelta,
      summedMsDelta: totalMs,
      waitsDelta: delta(prev.count, g.count),
    });
  }
  return trips;
}
