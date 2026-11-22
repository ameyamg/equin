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

/**
 * One instant on both clocks: the wall clock, and the sleep clock where the
 * platform can read it (`null`: it cannot — never "it did not sleep").
 * Stamp the START of anything whose age is judged later, store the stamp
 * beside it, and judge with {@link awakeBetween}.
 */
export interface ClockStamp {
  /** Epoch ms. */
  wallMs: number;
  sleep: SleepStamp | null;
}

/** A span between two stamps, the machine's sleep taken out. */
export interface AwakeSpan {
  /** `to.wallMs − from.wallMs`. */
  wallMs: number;
  /**
   * The sleep inside it, clamped to `[0, wallMs]`; `null` when it cannot be
   * told (a stamp without a sleep clock, or a reboot in between).
   */
  sleptMs: number | null;
  /**
   * The span less that sleep — what a watchdog, lease or staleness threshold
   * judges. Where the sleep cannot be told, the wall span: never in the
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
  if (now.sleep === null) return { wallMs, sleep: null };
  const sleptSince = Math.max(0, now.wallMs - wallMs - awakeMs);
  return {
    wallMs,
    sleep: { boot: now.sleep.boot, asleepMs: now.sleep.asleepMs - sleptSince },
  };
}

/** Whether a parsed JSON value is a {@link SleepStamp} (for stores read without zod). */
export function isSleepStamp(v: unknown): v is SleepStamp {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Partial<SleepStamp>;
  return typeof m.boot === "string" && typeof m.asleepMs === "number";
}
