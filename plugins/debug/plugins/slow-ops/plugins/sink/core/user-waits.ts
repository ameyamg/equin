/**
 * The end-to-end waits a person is having in this tab: a page load (navigation
 * start → every read on screen answered) or a recovery (socket drop → every
 * replayed read answered). The latency ledger opens one per measure and ends
 * or cancels it; the slow-op queue asks which wait an item's window fell in
 * (`userWaitDuring`), so a per-op finding seen while a person waited becomes
 * evidence of that wait's end-to-end report instead of a report of its own
 * (D26 step 3: research/2026-11-27-debug-per-op-findings-as-evidence.md).
 *
 * Only the two alerted measures open a wait: a per-op finding is held only
 * where an end-to-end report can carry it.
 */
export type UserWaitKind = "page-load" | "live-again";

export interface UserWait {
  readonly id: string;
  readonly kind: UserWaitKind;
  /** Wall-clock start (epoch ms). */
  readonly startedAt: number;
  /** The wait is over; its window stays known for items filed late. */
  end(): void;
  /**
   * The measure was dropped (the tab was hidden in it, the machine slept): no
   * person waited on it and it never alerts, so it holds nothing.
   */
  cancel(): void;
}

interface Entry {
  id: string;
  kind: UserWaitKind;
  startedAt: number;
  endedAt: number | null;
}

/**
 * How long an ended wait still claims items: an item reaches the queue when it
 * ends (an element at its settle) and is stamped at the flush, which waits up
 * to ~2 s for the page's stall record — so a few seconds would do; a minute
 * keeps a late emitter honest without growing the list (≤ a handful of waits).
 */
const ENDED_KEPT_MS = 60_000;

const waits: Entry[] = [];
let seq = 0;
/** Told each time a wait ends or is cancelled (the slow-op queue's deferred items). */
const settledListeners = new Set<() => void>();

function settled(): void {
  for (const fn of settledListeners) fn();
}

/**
 * Be told whenever a wait ends or is cancelled. Returns the unsubscribe. The
 * queue holds an item overlapping a wait still open until then: only an ended
 * wait claims it — a cancelled one (no person waited) lets it file on its own.
 */
export function onUserWaitSettled(fn: () => void): () => void {
  settledListeners.add(fn);
  return () => {
    settledListeners.delete(fn);
  };
}

function prune(now: number): void {
  for (let i = waits.length - 1; i >= 0; i--) {
    const w = waits[i]!;
    if (w.endedAt !== null && now - w.endedAt > ENDED_KEPT_MS)
      waits.splice(i, 1);
  }
}

function newId(kind: UserWaitKind): string {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 10);
  return `${kind}-${Date.now().toString(36)}-${rand}-${seq}`;
}

/** Open a wait that began at `startedAt` (wall clock, epoch ms). */
export function beginUserWait(kind: UserWaitKind, startedAt: number): UserWait {
  const entry: Entry = { id: newId(kind), kind, startedAt, endedAt: null };
  prune(Date.now());
  waits.push(entry);
  return {
    id: entry.id,
    kind,
    startedAt,
    end() {
      if (entry.endedAt !== null || !waits.includes(entry)) return;
      entry.endedAt = Date.now();
      settled();
    },
    cancel() {
      const i = waits.indexOf(entry);
      if (i < 0) return;
      waits.splice(i, 1);
      settled();
    },
  };
}

/**
 * The wait a window `[startMs, endMs]` (wall clock) overlaps — the oldest
 * still known — or undefined: no person was waiting end to end then. `open`:
 * the wait has not ended yet, so it may still be cancelled (the tab hidden,
 * the machine slept) — the caller holds its item until it settles.
 */
export function userWaitDuring(
  startMs: number,
  endMs: number,
): { id: string; kind: UserWaitKind; open: boolean } | undefined {
  prune(Date.now());
  for (const w of waits) {
    const end = w.endedAt ?? Number.POSITIVE_INFINITY;
    if (startMs <= end && endMs >= w.startedAt)
      return { id: w.id, kind: w.kind, open: w.endedAt === null };
  }
  return undefined;
}

/** Test-only: forget every wait. */
export function __resetUserWaits(): void {
  waits.length = 0;
}
