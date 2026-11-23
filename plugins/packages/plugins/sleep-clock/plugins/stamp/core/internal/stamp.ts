/**
 * Where the machine's sleep clock stood at one instant (packages/sleep-clock's
 * `readSleepClock`): which boot, and the time asleep since it, machine-wide.
 * Two stamps of one `boot` differ in `asleepMs` by exactly the time the machine
 * slept between them, whichever processes took them, however long apart.
 */
export interface SleepStamp {
  /** kern.bootsessionuuid — stamps compare only within one boot. */
  boot: string;
  /** Cumulative time asleep since that boot. */
  asleepMs: number;
}

declare const clockStampBrand: unique symbol;

/**
 * One instant on both clocks: the wall clock, and the sleep clock where the
 * platform can read it (`null`: it cannot — never "it did not sleep").
 * Stamp the START of anything whose age is judged later, store the stamp
 * beside it, and judge with {@link awakeBetween}.
 *
 * Branded: an object literal is not a stamp, so one instant's wall time cannot
 * be paired by hand with a sleep reading taken at another moment
 * (18ada4fbab: a `now` taken, then the sleep clock read after awaits). A stamp
 * comes from a reading (`sleep-clock`'s `clockStampNow` /
 * `processStartStamp`), from {@link stampBefore}, from a stored stamp parsed
 * whole (`stamp/schema`'s `ClockStampSchema`), or is named for what it is:
 * {@link clockStamp} (two halves read together, decoded) or
 * {@link unstampedInstant} (no sleep reading exists).
 */
export interface ClockStamp {
  /** Epoch ms. */
  readonly wallMs: number;
  readonly sleep: SleepStamp | null;
  readonly [clockStampBrand]: true;
}

/**
 * The stamp of one instant from its two halves, READ TOGETHER — by
 * `clockStampNow`, or by the process that wrote the record or the line being
 * decoded here. Never pair a wall instant with a sleep reading taken at
 * another moment: every span judged from it would drop the sleep in between.
 */
export function clockStamp(
  wallMs: number,
  sleep: SleepStamp | null,
): ClockStamp {
  return { wallMs, sleep } as ClockStamp;
}

/**
 * An instant nobody read the sleep clock at (a record from before stamps, a
 * DB timestamp, a holder last seen alive): its spans are judged on the wall
 * clock — never in the judged thing's favour.
 */
export function unstampedInstant(wallMs: number): ClockStamp {
  return clockStamp(wallMs, null);
}

/** A span between two stamps, the machine's sleep taken out. */
export interface AwakeSpan {
  /** `to.wallMs − from.wallMs`. */
  wallMs: number;
  /**
   * The sleep inside it, clamped to `[0, |wallMs|]` (a span with `to` before
   * `from` counts the sleep between them too); `null` when it cannot be
   * told (a stamp without a sleep clock, or a reboot in between).
   */
  sleptMs: number | null;
  /**
   * The span less that sleep (toward zero: a backward span stays negative) —
   * what a watchdog, lease or staleness threshold judges. Where the sleep cannot be told, the wall span: never in the
   * judged thing's favour.
   */
  awakeMs: number;
}

/**
 * ms the machine slept between two sleep stamps, or `null` when it cannot be
 * told: either side unstamped, or the stamps belong to different boots.
 */
export function sleptBetween(
  from: SleepStamp | null,
  to: SleepStamp | null,
): number | null {
  if (from === null || to === null || from.boot !== to.boot) return null;
  // The two raw clocks are read a few hundred ns apart: clamp the jitter.
  return Math.max(0, to.asleepMs - from.asleepMs);
}

/**
 * The span from `from` to `to` judged on AWAKE time. A sleeping Mac runs
 * nothing — not the process being watched, not the one it waits on, not the
 * sampler that refreshes a reading — so a nap ages nothing a watchdog
 * judges. On the wall clock every wake looks like a hang as long as the nap.
 */
export function awakeBetween(from: ClockStamp, to: ClockStamp): AwakeSpan {
  const wallMs = to.wallMs - from.wallMs;
  if (wallMs < 0) {
    // `to` came first (a reordered pair: one stretch measured from an
    // instant after its end). The sleep between them is the reverse span's,
    // and the awake span stays negative — a nap between them shortens it in
    // either direction, never lengthens it.
    const back = sleptBetween(to.sleep, from.sleep);
    const sleptMs = back === null ? null : Math.min(-wallMs, back);
    return { wallMs, sleptMs, awakeMs: wallMs + (sleptMs ?? 0) };
  }
  const slept = sleptBetween(from.sleep, to.sleep);
  const sleptMs = slept === null ? null : Math.min(Math.max(0, wallMs), slept);
  return { wallMs, sleptMs, awakeMs: wallMs - (sleptMs ?? 0) };
}

/**
 * The stamp of an earlier instant `wallMs`, worked out at `now` from the
 * `awakeMs` this process timed since then on a clock that pauses through sleep
 * (`performance.now()`): what is left of the wall time since is sleep. For a
 * start that is over before anything can stamp it — a process's own. Pairing
 * that instant with a stamp taken later instead would count every sleep in
 * between as time awake.
 */
export function stampBefore(
  now: ClockStamp,
  wallMs: number,
  awakeMs: number,
): ClockStamp {
  if (now.sleep === null) return unstampedInstant(wallMs);
  const sleptSince = Math.max(0, now.wallMs - wallMs - awakeMs);
  return clockStamp(wallMs, {
    boot: now.sleep.boot,
    asleepMs: now.sleep.asleepMs - sleptSince,
  });
}

/** Whether a parsed JSON value is a {@link SleepStamp} (for stores read without zod). */
export function isSleepStamp(v: unknown): v is SleepStamp {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Partial<SleepStamp>;
  return typeof m.boot === "string" && typeof m.asleepMs === "number";
}
