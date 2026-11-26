import { GMAIL_USER_UNITS_PER_MINUTE } from "./quota";

/**
 * Who is waiting. `foreground` is a read or write a person waits on (a window
 * being filled, an archive); `background` is work nobody waits on (body
 * prefetch, revalidation). A background call is admitted only while no
 * foreground call waits, and only into `backgroundShare` of the window, so
 * prefetch can never take the room a click needs.
 */
export type GmailPriority = "foreground" | "background";

/**
 * The clock the pacer waits on; a test hands it a fake one. Monotonic: a
 * wall clock stepped back (NTP, a manual change) would leave charges in the
 * "future" and stall admission for the size of the jump.
 */
export type PacerClock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

const systemClock: PacerClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type QuotaPacerOptions = {
  /** Units admitted per rolling 60 s. Default: Gmail's per-user budget. */
  unitsPerMinute?: number;
  /** The part of the window background calls may fill (0–1]. Default 0.5. */
  backgroundShare?: number;
  clock?: PacerClock;
};

export type QuotaPacerStats = {
  /** Units admitted in the last 60 s. */
  windowUnits: number;
  /** Units admitted since the pacer was made (what a probe reports). */
  spentUnits: number;
  queued: Record<GmailPriority, number>;
  /** While Google asked us to back off: how long until admission resumes. */
  pausedForMs: number | null;
};

export type QuotaPacer = {
  /**
   * Resolves once `units` fit in the window for `priority`, and charges them.
   * Charge before the call: Google counts a call it refuses too. Rejects with
   * the signal's reason when `signal` aborts while waiting.
   */
  acquire(
    units: number,
    opts: {
      priority: GmailPriority;
      signal?: AbortSignal;
      /**
       * Called only when the call has to wait (no room, or paused) — never
       * for one admitted at once — and its return called once the wait ends
       * (admitted or aborted). The transport meters the wait through it, so
       * a request held by the account's budget names the budget instead of
       * booking the wait as its own time.
       */
      onQueued?: () => () => void;
    },
  ): Promise<void>;
  /**
   * Admit nothing for `ms`. Called when Google refuses a call for rate (429,
   * 403 rateLimitExceeded): the budget is per user, so every caller backs off,
   * not only the one that was refused. A later, shorter pause never shortens
   * an earlier one.
   */
  pause(ms: number): void;
  /** The most units one `priority` call may ask for: its share of the window. */
  capacity(priority: GmailPriority): number;
  stats(): QuotaPacerStats;
};

const WINDOW_MS = 60_000;

type Waiter = {
  units: number;
  resolve: () => void;
  reject: (reason: unknown) => void;
  detach: () => void;
};

/**
 * One account's Gmail quota pacer: a sliding 60 s window of admitted units —
 * exactly Gmail's "units per user per minute", whatever window Google keeps —
 * with two FIFO queues, foreground ahead of background, and a shared pause.
 *
 * Make ONE per account per process and pass it to every client of that
 * account: two pacers over one account would each spend the whole budget.
 * Waits are timers set for the instant room opens (the oldest charge leaving
 * the window, or a pause ending), never a polling tick.
 */
export function createQuotaPacer(opts: QuotaPacerOptions = {}): QuotaPacer {
  const limit = opts.unitsPerMinute ?? GMAIL_USER_UNITS_PER_MINUTE;
  const share = opts.backgroundShare ?? 0.5;
  const clock = opts.clock ?? systemClock;
  if (!(limit > 0)) throw new Error(`unitsPerMinute must be > 0, got ${limit}`);
  if (!(share > 0 && share <= 1)) {
    throw new Error(`backgroundShare must be in (0, 1], got ${share}`);
  }
  const capOf = (p: GmailPriority) =>
    p === "foreground" ? limit : limit * share;

  const charges: { at: number; units: number }[] = [];
  let windowUnits = 0;
  let spentUnits = 0;
  let pausedUntil = 0;
  const queues: Record<GmailPriority, Waiter[]> = {
    foreground: [],
    background: [],
  };
  let timer: { handle: unknown; at: number } | null = null;

  function prune(now: number) {
    while (charges.length > 0 && charges[0]!.at + WINDOW_MS <= now) {
      windowUnits -= charges.shift()!.units;
    }
  }

  function charge(now: number, units: number) {
    charges.push({ at: now, units });
    windowUnits += units;
    spentUnits += units;
  }

  /** When `units` more fit under `cap`, as the oldest charges leave the window. */
  function roomAt(units: number, cap: number): number {
    let left = windowUnits;
    for (const c of charges) {
      left -= c.units;
      if (left + units <= cap) return c.at + WINDOW_MS;
    }
    // Unreachable: acquire refuses a call larger than its cap.
    throw new Error(`quota pacer: ${units} units can never fit under ${cap}`);
  }

  function arm(at: number) {
    if (timer && timer.at <= at) return;
    if (timer) clock.clearTimeout(timer.handle);
    const handle = clock.setTimeout(
      () => {
        timer = null;
        pump();
      },
      Math.max(0, at - clock.now()),
    );
    timer = { handle, at };
  }

  function pump() {
    const now = clock.now();
    if (now < pausedUntil) {
      if (queues.foreground.length + queues.background.length > 0)
        arm(pausedUntil);
      return;
    }
    prune(now);
    for (;;) {
      const priority: GmailPriority | null =
        queues.foreground.length > 0
          ? "foreground"
          : queues.background.length > 0
            ? "background"
            : null;
      if (priority === null) return;
      const head = queues[priority][0]!;
      const cap = capOf(priority);
      if (windowUnits + head.units > cap) {
        arm(roomAt(head.units, cap));
        return;
      }
      queues[priority].shift();
      head.detach();
      charge(now, head.units);
      head.resolve();
    }
  }

  return {
    acquire(units, { priority, signal, onQueued }) {
      if (!(Number.isInteger(units) && units > 0)) {
        throw new Error(
          `quota pacer: units must be a positive integer, got ${units}`,
        );
      }
      const cap = capOf(priority);
      if (units > cap) {
        throw new Error(
          `quota pacer: a ${priority} call of ${units} units can never fit in its ${cap}-unit window; split it`,
        );
      }
      signal?.throwIfAborted();
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        let endWait: (() => void) | null = null;
        const settle = () => {
          settled = true;
          endWait?.();
          endWait = null;
        };
        const onAbort = () => {
          const q = queues[priority];
          const i = q.indexOf(waiter);
          if (i >= 0) q.splice(i, 1);
          settle();
          reject(signal!.reason);
          // The head may have been the one blocking the next caller.
          pump();
        };
        const waiter: Waiter = {
          units,
          resolve: () => {
            settle();
            resolve();
          },
          reject,
          detach: () => signal?.removeEventListener("abort", onAbort),
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        queues[priority].push(waiter);
        pump();
        // Still queued after the pump: it waits for room.
        if (!settled && onQueued) endWait = onQueued();
      });
    },
    pause(ms) {
      const until = clock.now() + ms;
      if (until <= pausedUntil) return;
      pausedUntil = until;
      if (queues.foreground.length + queues.background.length > 0)
        arm(pausedUntil);
    },
    capacity: capOf,
    stats() {
      const now = clock.now();
      prune(now);
      return {
        windowUnits,
        spentUnits,
        queued: {
          foreground: queues.foreground.length,
          background: queues.background.length,
        },
        pausedForMs: now < pausedUntil ? pausedUntil - now : null,
      };
    },
  };
}
