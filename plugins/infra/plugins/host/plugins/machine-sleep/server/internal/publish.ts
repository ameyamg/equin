import { readSleepClock } from "@plugins/packages/plugins/sleep-clock/core";
import {
  awakeSpanStart as historyAwakeSpanStart,
  currentSleepReading as historyCurrentReading,
  darkWakeDuring as historyDarkWakeDuring,
  installSleepClock,
  onSleepReadingChanged as historyOnChanged,
  publishSleepReading as historyPublish,
  sleptDuring as historySleptDuring,
  stampOfWallInstant as historyStampOfWallInstant,
  wakeBefore as historyWakeBefore,
  type WakeBefore,
} from "@plugins/packages/plugins/sleep-clock/plugins/history/core";
import type { ClockStamp } from "@plugins/packages/plugins/sleep-clock/plugins/stamp/core";
import type { SleepNow } from "../../core";

// This process's sleep history is `packages/sleep-clock/history`'s — one per
// process, shared with the portable code that judges ages on every host (the
// change feed, server-core's delivery spans). What this half adds is the clock:
// loading it installs the native reader (bun:ffi), so every process that
// imports it — a backend, an exec child, a CLI — judges on the real sleeps,
// whether or not its entry ran the desktop's host probes (which install the
// same reader; installing it twice is a no-op).
installSleepClock(readSleepClock);

/**
 * Read the machine's sleep clock and push it if it changed — in practice only
 * after a wake. Cheap (two clock reads and one sysctl), so a periodic observer
 * that already runs can call it on every tick; it adds no poller of its own.
 */
export function publishSleepReading(): void {
  historyPublish();
}

/** The last published reading, reading the clock first if nothing was yet. */
export function currentSleepReading(): SleepNow {
  return historyCurrentReading();
}

/** Run `fn` whenever {@link publishSleepReading} finds a changed reading. Returns the unsubscribe. */
export function onSleepReadingChanged(fn: () => void): () => void {
  return historyOnChanged(fn);
}

/**
 * ms the machine slept inside `[startMs, endMs]` (epoch ms) — for taking a nap
 * off a span timed on the wall clock (a slow-op measured in a browser). Reads
 * the clock first, so a wake moments ago counts. A process knows only the
 * sleeps it lived through; `null` where the platform cannot tell.
 */
export function sleptDuring(startMs: number, endMs: number): number | null {
  return historySleptDuring(startMs, endMs);
}

/**
 * ms of `[startMs, endMs]` (epoch ms) the machine spent in a DARK wake — awake
 * for maintenance (a lid-shut Mac's Power Nap), not for a person — disjoint
 * from {@link sleptDuring}. For judging what a person waited on (slow-ops):
 * the awake clock runs through a dark wake, so a span that crossed several of
 * them adds their seconds up. Never for a watchdog — work runs there. `null`
 * where the platform cannot tell.
 */
export function darkWakeDuring(startMs: number, endMs: number): number | null {
  return historyDarkWakeDuring(startMs, endMs);
}

/**
 * The stamp of a past wall instant nothing could stamp when it happened (a
 * DB row's `created_at`), worked out at `now` from the sleep this process saw
 * since ({@link sleptDuring}): a span from it to a real stamp is then judged
 * on awake time like any other (`awakeBetween`). Unstamped (`sleep: null`)
 * where that sleep cannot be told. Take `now` from `clockStampNow()` and
 * store it too: both stamps then name their own instants.
 */
export function stampOfWallInstant(
  wallMs: number,
  now: ClockStamp,
): ClockStamp {
  return historyStampOfWallInstant(wallMs, now);
}

/**
 * The wall-clock instant (epoch ms) `awakeMs` of AWAKE time before `endMs` —
 * for a bound on work this machine does that a wall-clock age would let a nap
 * spend (the job sweeper's lock-acquisition grace). Reads the clock first, so a
 * wake moments ago counts. A process knows only the sleeps it lived through;
 * `null` where the platform cannot tell.
 */
export function awakeSpanStart(endMs: number, awakeMs: number): number | null {
  return historyAwakeSpanStart(endMs, awakeMs);
}

/**
 * Whether the machine had just woken at `atMs` (epoch ms): the sleep this
 * process saw end in the `withinMs` before it — for saying so on what a wake
 * explains (a timer that counted the nap firing the moment the box woke). Reads
 * the clock first, so a wake moments ago counts. A process knows only the
 * sleeps it lived through: `sleep: null` is "none seen", and
 * `{ supported: false }` where the platform cannot tell.
 */
export function wakeBefore(atMs: number, withinMs: number): WakeBefore {
  return historyWakeBefore(atMs, withinMs);
}
