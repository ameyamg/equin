/**
 * One reading of the machine's sleep clock, as `packages/sleep-clock`'s
 * `readSleepClock()` takes it (over bun:ffi) and a host installs it
 * (`installSleepClock`). Declared in this portable leaf so code that judges
 * ages on every host imports nothing that needs the computer.
 */
export type SleepClockReading =
  | {
      supported: true;
      /** kern.bootsessionuuid — `asleepMs` of two readings compare only within one boot. */
      boot: string;
      /** Cumulative time asleep since boot (MONOTONIC_RAW − UPTIME_RAW), machine-wide. */
      asleepMs: number;
      /** kern.waketime: the wall instant (epoch ms) of the last wake; null if never woke or unreadable. */
      wakeAtMs: number | null;
      /**
       * kern.sleeptime: the wall instant (epoch ms) the machine last went to
       * sleep; null if it never slept or unreadable. Before `wakeAtMs`, the
       * two bound the last sleep — so a process started after a wake can
       * still place it.
       */
      sleepAtMs: number | null;
      /** The wall instant (epoch ms) this reading was taken at. */
      atMs: number;
      /**
       * Whether the machine was in a DARK wake at `atMs` — awake for
       * maintenance (Power Nap, a lid-shut Mac's network upkeep: no graphics
       * capability), not for a person; null when it cannot tell. The process
       * runs in a dark wake, so the awake clock counts it; what a person waits
       * on does not happen there.
       */
      darkWake: boolean | null;
    }
  /** This platform offers no such clocks here — NOT "it did not sleep". */
  | { supported: false };

/**
 * Where the machine's sleep clock stands, as a process remembers it: boot,
 * cumulative time asleep, last wake — or `null` where the platform cannot tell
 * (never "did not sleep"). `machine-sleep`'s live value carries the same shape.
 */
export type SleepNow = {
  boot: string;
  asleepMs: number;
  wakeAtMs: number | null;
} | null;

/**
 * Reading the two clocks a few hundred nanoseconds apart jitters `asleepMs` by a
 * hair on every read; only a sleep moves it by a whole millisecond or more.
 */
const ASLEEP_EPSILON_MS = 1;

export function toSleepNow(r: SleepClockReading): SleepNow {
  return r.supported
    ? { boot: r.boot, asleepMs: r.asleepMs, wakeAtMs: r.wakeAtMs }
    : null;
}

/** Whether `next` says something `prev` did not: a new boot, a new wake, or more sleep. */
export function sleepNowChanged(prev: SleepNow, next: SleepNow): boolean {
  if (prev === null || next === null) return prev !== next;
  return (
    prev.boot !== next.boot ||
    prev.wakeAtMs !== next.wakeAtMs ||
    Math.abs(next.asleepMs - prev.asleepMs) >= ASLEEP_EPSILON_MS
  );
}

/** One sleep placed on the wall clock (epoch ms). */
export interface SleepInterval {
  startMs: number;
  endMs: number;
}

/** How many placed sleeps are kept: a caller asks about spans that just ended. */
const SLEEP_RING_CAP = 50;

/**
 * The sleep `next` adds over `prev`, placed on the wall clock — or null when
 * none, or when it cannot be placed. The clock knows only how much more the box
 * slept and when it last woke, so all of it is placed as ONE sleep ending at
 * that wake: several naps between two readings (dark-wake cycles) read as one
 * stretch ending at the last wake — never more sleep than there was, though
 * possibly later than it happened. A new boot, or no wake time, places nothing.
 */
export function sleepBetween(
  prev: SleepNow,
  next: SleepNow,
): SleepInterval | null {
  if (prev === null || next === null || prev.boot !== next.boot) return null;
  const slept = next.asleepMs - prev.asleepMs;
  if (slept < ASLEEP_EPSILON_MS || next.wakeAtMs === null) return null;
  return { startMs: next.wakeAtMs - slept, endMs: next.wakeAtMs };
}

/**
 * The last sleep as the clock itself places it — from when the machine went to
 * sleep to when it woke — or null when it cannot (never slept, unreadable, or
 * asleep again since the wake: then the pair bounds no one sleep). This is
 * what a process started AFTER a wake knows of the sleep before it: without
 * it, a backend booted on the wake judged everything that crossed the nap on
 * the wall clock (queue-health filed one post-wake backlog per such boot).
 */
export function lastSleepOf(r: SleepClockReading): SleepInterval | null {
  if (!r.supported || r.wakeAtMs === null || r.sleepAtMs === null) return null;
  if (r.sleepAtMs >= r.wakeAtMs) return null;
  return { startMs: r.sleepAtMs, endMs: r.wakeAtMs };
}

/** ms of `[startMs, endMs]` covered by the union of `sleeps`. */
export function overlapMs(
  sleeps: readonly SleepInterval[],
  startMs: number,
  endMs: number,
): number {
  let total = 0;
  let frontier = startMs;
  for (const s of [...sleeps].sort((a, b) => a.startMs - b.startMs)) {
    const from = Math.max(s.startMs, frontier);
    const to = Math.min(s.endMs, endMs);
    if (to > from) {
      total += to - from;
      frontier = to;
    }
  }
  return total;
}

/**
 * The wall-clock instant from which the span up to `endMs` holds exactly
 * `awakeMs` of time the machine was AWAKE, given the sleeps placed so far:
 * walking back from `endMs`, every placed sleep is stepped over rather than
 * counted. With no sleep in reach it is `endMs - awakeMs`.
 *
 * A sleep placed later than it really happened (several naps read as one
 * stretch, see `sleepBetween`) only moves the answer earlier — it reads awake
 * time as sleep, never sleep as awake time.
 */
export function awakeSpanStartMs(
  sleeps: readonly SleepInterval[],
  endMs: number,
  awakeMs: number,
): number {
  let cursor = endMs;
  let need = awakeMs;
  // Latest-ending first; overlapping sleeps are stepped over together.
  for (const s of [...sleeps].sort((a, b) => b.endMs - a.endMs)) {
    if (s.startMs >= cursor) continue;
    const gap = cursor - Math.min(s.endMs, cursor);
    if (gap >= need) return cursor - need;
    need -= gap;
    cursor = s.startMs;
  }
  return cursor - need;
}

/**
 * The latest placed sleep that ENDED inside `[atMs - withinMs, atMs]` — the
 * wake `atMs` came just after — or null when none did.
 */
export function wakeWithin(
  sleeps: readonly SleepInterval[],
  atMs: number,
  withinMs: number,
): SleepInterval | null {
  let latest: SleepInterval | null = null;
  for (const s of sleeps) {
    if (s.endMs > atMs || s.endMs < atMs - withinMs) continue;
    if (latest === null || s.endMs > latest.endMs) latest = s;
  }
  return latest;
}

/**
 * The time `[startMs, endMs]` spent in a dark wake: covered by `darks` and by
 * none of `sleeps` (a dark stretch is placed from its wake, so a sleep it
 * overlaps — several naps read as one, see `sleepBetween` — is sleep, never
 * counted twice).
 */
export function darkOverlapMs(
  sleeps: readonly SleepInterval[],
  darks: readonly SleepInterval[],
  startMs: number,
  endMs: number,
): number {
  if (darks.length === 0) return 0;
  return Math.max(
    0,
    overlapMs([...sleeps, ...darks], startMs, endMs) -
      overlapMs(sleeps, startMs, endMs),
  );
}

/** What {@link SleepPublisher.wakeBefore} answers. */
export type WakeBefore =
  /** The platform cannot tell — NOT "the machine did not wake". */
  | { supported: false }
  /** The sleep whose wake came in the window, or null when this process saw none. */
  | { supported: true; sleep: SleepInterval | null };

export interface SleepPublisher {
  /** The last published reading, reading the clock first if nothing was yet. */
  current(): SleepNow;
  /** Read the clock; tell every listener only when it changed. */
  publish(): void;
  /**
   * ms the machine slept inside `[startMs, endMs]` (epoch ms), from the sleeps
   * this process has seen — reading the clock first, so a wake moments ago
   * counts. `null` where the platform cannot tell (never "did not sleep").
   */
  sleptDuring(startMs: number, endMs: number): number | null;
  /**
   * ms of `[startMs, endMs]` (epoch ms) the machine spent in a DARK wake —
   * awake for maintenance, not for a person — from the readings this process
   * took (reading the clock first). Disjoint from `sleptDuring`: the two add
   * up to the time no person could have been waiting. `null` where the
   * platform cannot tell (never "it was fully awake").
   */
  darkWakeDuring(startMs: number, endMs: number): number | null;
  /**
   * The wall-clock instant (epoch ms) `awakeMs` of AWAKE time before `endMs`,
   * stepping over the sleeps this process has seen — reading the clock first,
   * so a wake moments ago counts. `null` where the platform cannot tell.
   */
  awakeSpanStart(endMs: number, awakeMs: number): number | null;
  /**
   * The sleep this process saw end in the `withinMs` before `atMs` (epoch ms)
   * — "had the machine just woken?" — reading the clock first, so a wake
   * moments ago counts.
   */
  wakeBefore(atMs: number, withinMs: number): WakeBefore;
  /** Run `fn` on every changed reading `publish` finds. Returns the unsubscribe. */
  subscribe(fn: () => void): () => void;
}

/**
 * The set-if-changed core of the publisher, with the clock injected.
 *
 * `mayHaveSlept` gates the reads a QUERY makes (`sleptDuring`, `awakeSpanStart`,
 * `wakeBefore`): false means no sleep can have happened since the last read,
 * so the answer stands without reading the clock again (an FFI read plus two
 * sysctls — the change feed asks on every routed change). `publish()` itself
 * always reads. Default: always read.
 */
export function createSleepPublisher(
  read: () => SleepClockReading,
  mayHaveSlept: () => boolean = () => true,
): SleepPublisher {
  let last: { value: SleepNow } | null = null;
  const listeners = new Set<() => void>();
  const sleeps: SleepInterval[] = [];
  // Dark-wake stretches, each from where a reading first saw it dark to the
  // last reading that still did (or to the sleep that ended it). `openDark`
  // is the current wake's stretch while the latest reading saw it dark: every
  // reading extends it. Placed only from readings, so a dark wake this process
  // took none in counts as awake — the judged thing's disfavour, never its
  // favour.
  const darks: SleepInterval[] = [];
  let openDark: { wakeAtMs: number; stretch: SleepInterval } | null = null;
  // The latest reading that could tell: which wake, when, and whether dark.
  let seen: { wakeAtMs: number | null; atMs: number } | null = null;
  // Whether any reading could tell a dark wake from a full one.
  let darkKnown = false;
  const place = (s: SleepInterval | null): void => {
    if (s === null) return;
    sleeps.push(s);
    if (sleeps.length > SLEEP_RING_CAP) sleeps.shift();
    // A sleep ends the dark wake before it: the stretch reaches the sleep's
    // start (exact for one nap; for several read as one, the stretch stays
    // where its readings put it — shorter, never longer).
    if (openDark !== null && s.startMs > openDark.stretch.startMs) {
      openDark.stretch.endMs = Math.max(openDark.stretch.endMs, s.startMs);
      openDark = null;
    }
  };
  const noteWake = (reading: SleepClockReading): void => {
    if (!reading.supported || reading.darkWake === null) return;
    darkKnown = true;
    const { wakeAtMs, atMs } = reading;
    const prev = seen;
    seen = { wakeAtMs, atMs };
    if (!reading.darkWake || wakeAtMs === null) {
      // Fully awake: the current wake's stretch ends at its last dark reading.
      openDark = null;
      return;
    }
    if (openDark !== null && openDark.wakeAtMs === wakeAtMs) {
      openDark.stretch.endMs = Math.max(openDark.stretch.endMs, atMs);
      return;
    }
    // Where this dark stretch began, as far as the readings can tell:
    // - a reading of this same wake saw it full (a full wake turned dark with
    //   no new wake — the graphics-off step of a sleep entry): after that one;
    // - the first reading this process took: here — what came before is not
    //   known, and is never counted as dark;
    // - otherwise the machine woke since the last reading: from that wake.
    const startMs =
      prev === null ? atMs : prev.wakeAtMs === wakeAtMs ? prev.atMs : wakeAtMs;
    const stretch = { startMs, endMs: Math.max(startMs, atMs) };
    openDark = { wakeAtMs, stretch };
    darks.push(stretch);
    if (darks.length > SLEEP_RING_CAP) darks.shift();
  };
  // The first reading has no previous one to diff: the clock's own last sleep
  // is the one sleep it can place (the one this process started after).
  const first = (reading: SleepClockReading): SleepNow => {
    place(lastSleepOf(reading));
    noteWake(reading);
    last = { value: toSleepNow(reading) };
    return last.value;
  };
  // While the current wake is dark, every query reads: the wake may have
  // turned full (a lid opened) with no sleep to move the clocks' offset.
  const refresh = (): void => {
    if (last === null || openDark !== null || mayHaveSlept()) publish();
  };
  const publish = (): void => {
    const reading = read();
    if (last === null) first(reading);
    else {
      const next = toSleepNow(reading);
      if (!sleepNowChanged(last.value, next)) {
        noteWake(reading);
        return;
      }
      place(sleepBetween(last.value, next));
      noteWake(reading);
      last = { value: next };
    }
    for (const fn of listeners) fn();
  };
  return {
    current() {
      return last === null ? first(read()) : last.value;
    },
    publish,
    sleptDuring(startMs, endMs) {
      refresh();
      if (last?.value === null) return null;
      return overlapMs(sleeps, startMs, endMs);
    },
    darkWakeDuring(startMs, endMs) {
      refresh();
      if (last?.value === null || !darkKnown) return null;
      return darkOverlapMs(sleeps, darks, startMs, endMs);
    },
    awakeSpanStart(endMs, awakeMs) {
      refresh();
      if (last?.value === null) return null;
      return awakeSpanStartMs(sleeps, endMs, awakeMs);
    },
    wakeBefore(atMs, withinMs) {
      refresh();
      if (last?.value === null) return { supported: false };
      return { supported: true, sleep: wakeWithin(sleeps, atMs, withinMs) };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
