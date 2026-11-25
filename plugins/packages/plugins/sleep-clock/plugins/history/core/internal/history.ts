import { wallNow } from "@plugins/packages/plugins/deadline/core";
import {
  stampBefore,
  unstampedInstant,
  type ClockStamp,
} from "@plugins/packages/plugins/sleep-clock/plugins/stamp/core";
import {
  createSleepPublisher,
  type SleepClockReading,
  type SleepNow,
  type SleepPublisher,
  type WakeBefore,
} from "./sleep-publisher";

// ── This process's sleep history, on every host ──────────────────────────────
//
// What a process knows of the machine's sleeps is a property of the PROCESS,
// not of any plugin: every judge of an age — a core module, the portable change
// feed, a machine half — asks the same question ("how much of this wall span
// was the machine asleep?") and must get the same answer. So the history lives
// here, in a leaf that imports nothing that needs the computer, and the one
// thing that does — reading the OS clocks over bun:ffi — is INSTALLED into it
// by the host (`installSleepClock(readSleepClock)`: the desktop's host probes
// before boot, and `infra/host/machine-sleep`'s server half wherever it is
// loaded). A host that installs none (a page's worker) has no sleep clock:
// every answer is "cannot tell" (`null`), and an age falls back to the wall
// clock — never in the judged thing's favour.

let installed: (() => SleepClockReading) | null = null;
let publisher: SleepPublisher | null = null;

const UNSUPPORTED: SleepClockReading = { supported: false };

/**
 * Install this host's sleep-clock reader. Idempotent for the same reader (the
 * host probes and machine-sleep both install `readSleepClock`); a different
 * one throws — two readers would make two histories disagree.
 */
export function installSleepClock(read: () => SleepClockReading): void {
  if (installed === read) return;
  if (installed !== null) {
    throw new Error(
      "[sleep-clock/history] a different sleep clock is already installed in this process.",
    );
  }
  installed = read;
  publisher = createSleepPublisher(read, offsetMoved);
}

// A sleep shows as the wall clock pulling ahead of the monotonic one
// (`performance.now()` pauses while the machine sleeps; the wall clock does
// not). While their offset has not moved by OFFSET_SLACK_MS since the last
// look — read jitter (`Date.now()` is whole milliseconds) stays well inside
// it, a sleep is seconds at the least — no sleep can have happened — so a query answers from the history it
// has instead of reading the OS clocks. A wall-clock step (NTP) also moves the
// offset; it only costs one read.
const OFFSET_SLACK_MS = 50;
let lastOffsetMs: number | null = null;
function offsetMoved(): boolean {
  const offset = wallNow("sleep-detection") - performance.now();
  const moved =
    lastOffsetMs === null || Math.abs(offset - lastOffsetMs) >= OFFSET_SLACK_MS;
  if (moved) lastOffsetMs = offset;
  return moved;
}

/** The installed clock read now; `{ supported: false }` where none is installed. */
export function readInstalledSleepClock(): SleepClockReading {
  return installed === null ? UNSUPPORTED : installed();
}

/**
 * Read the machine's sleep clock and tell listeners if it changed — in
 * practice only after a wake. Cheap; a periodic observer that already runs
 * calls it on every tick. A no-op with no clock installed.
 */
export function publishSleepReading(): void {
  publisher?.publish();
}

/** The last reading, reading the clock first if nothing was yet; `null` when it cannot tell. */
export function currentSleepReading(): SleepNow {
  return publisher === null ? null : publisher.current();
}

/** Run `fn` whenever {@link publishSleepReading} finds a changed reading. Returns the unsubscribe. */
export function onSleepReadingChanged(fn: () => void): () => void {
  if (publisher === null) return () => {};
  return publisher.subscribe(fn);
}

/**
 * ms the machine slept inside `[startMs, endMs]` (epoch ms), from the sleeps
 * this process saw (plus the one before its first reading). Reads the clock
 * first, so a wake moments ago counts. `null` where it cannot tell.
 */
export function sleptDuring(startMs: number, endMs: number): number | null {
  return publisher === null ? null : publisher.sleptDuring(startMs, endMs);
}

/**
 * ms the machine spent in a DARK wake inside `[startMs, endMs]` (epoch ms) —
 * awake for maintenance, not for a person — disjoint from `sleptDuring`.
 * Reads the clock first. `null` where it cannot tell. For a judgment of what a
 * person waited on (slow-ops), never for a watchdog: work runs in a dark wake,
 * so a deadline on it keeps counting there.
 */
export function darkWakeDuring(startMs: number, endMs: number): number | null {
  return publisher === null ? null : publisher.darkWakeDuring(startMs, endMs);
}

/**
 * The AWAKE time since a past wall instant nothing could stamp (a Postgres
 * commit's `clock_timestamp()`, a change's `changedAt`), as of now: the wall
 * span less the sleep this process saw inside it. Where the sleep cannot be
 * told it is the wall span — an age is never shortened by a guess. Never
 * below 0.
 */
export function awakeMsSince(fromMs: number): number {
  // The wall gap is read to take the sleep out of it.
  const nowMs = wallNow("sleep-detection");
  return Math.max(0, nowMs - fromMs - (sleptDuring(fromMs, nowMs) ?? 0));
}

/**
 * The stamp of a past wall instant nothing stamped (a DB row's `created_at`),
 * worked out at `now` from the sleep this process saw since: a span from it to
 * a real stamp is then judged on awake time (`awakeBetween`). Unstamped
 * (`sleep: null`) where that sleep cannot be told.
 */
export function stampOfWallInstant(
  wallMs: number,
  now: ClockStamp,
): ClockStamp {
  const slept = sleptDuring(wallMs, now.wallMs);
  if (slept === null) return unstampedInstant(wallMs);
  return stampBefore(now, wallMs, now.wallMs - wallMs - slept);
}

/**
 * The wall-clock instant `awakeMs` of AWAKE time before `endMs`, stepping over
 * the sleeps this process saw. `null` where it cannot tell.
 */
export function awakeSpanStart(endMs: number, awakeMs: number): number | null {
  return publisher === null ? null : publisher.awakeSpanStart(endMs, awakeMs);
}

/**
 * Whether the machine had just woken at `atMs`: the sleep this process saw end
 * in the `withinMs` before it. `{ supported: false }` where it cannot tell.
 */
export function wakeBefore(atMs: number, withinMs: number): WakeBefore {
  return publisher === null
    ? { supported: false }
    : publisher.wakeBefore(atMs, withinMs);
}
