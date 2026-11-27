import { GMAIL_USER_UNITS_PER_MINUTE } from "./quota";

/**
 * Who is waiting, highest first. Each tier has its own admission rule over
 * the one 60 s window:
 * - `foreground`: a read or write a person waits on (a window being filled,
 *   an archive). Admitted while the whole window has room.
 * - `background`: upkeep nobody waits on but that keeps what is shown
 *   correct (a change sync step, a re-list). Admitted only while no
 *   foreground call waits, and while its OWN charges stay within
 *   `backgroundShare` of the window (and the whole window has room).
 * - `speculative`: work that may be wasted (body prefetch). Admitted only
 *   while nothing above it waits, and only while the WHOLE window — every
 *   tier's charges — stays within `speculativeShare`: it spends what is idle.
 *
 * Why no tier starves the one above it:
 * - A lower tier is admitted only while every higher queue is empty (a head
 *   that does not fit holds every tier below it).
 * - Foreground: background charges never exceed `backgroundShare` and
 *   speculative ones `speculativeShare`, so foreground always finds
 *   `1 - backgroundShare - speculativeShare` of the window no lower tier can
 *   hold.
 * - Background: speculative charges never count against its share, so
 *   prefetch never delays a sync step — only a full window can, and
 *   speculative charges are at most `speculativeShare` of it. (Before this
 *   tier, prefetch shared the background FIFO and share, and a 2-unit sync
 *   step waited 53 s behind it: task-1795743099-v6pv5z.)
 * - Speculative waits as long as the tiers above keep the window busy: it is
 *   the work meant to yield.
 */
export type GmailPriority = "foreground" | "background" | "speculative";

/** The priorities, highest first: the order the pacer admits queued calls in. */
const PRIORITIES: readonly GmailPriority[] = [
  "foreground",
  "background",
  "speculative",
];

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
  /** The part of the window background calls' own charges may fill (0–1]. Default 0.5. */
  backgroundShare?: number;
  /**
   * The part of the window under which a speculative call is admitted,
   * counting every tier's charges (0–1]. Default half of `backgroundShare`.
   */
  speculativeShare?: number;
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

/** What held a queued call as it queued: this pacer's minute, or Google's rate refusal. */
export type PacerWaitReason = "budget" | "paused";

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
       * Called only when the call has to wait — never for one admitted at
       * once — and its return called once the wait ends (admitted or
       * aborted). The transport meters the wait through it, so a request
       * held by the account's budget names the budget instead of booking the
       * wait as its own time. `why` is what held it as it queued: `budget`
       * (this pacer's minute is spent) or `paused` (Google refused a call for
       * rate — usually another process spending the same account's budget,
       * which this pacer cannot see).
       */
      onQueued?: (why: PacerWaitReason) => () => void;
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
 * with one FIFO queue per priority (`GmailPriority`, highest first) and a
 * shared pause.
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
  const speculative = opts.speculativeShare ?? share / 2;
  if (!(speculative > 0 && speculative <= 1)) {
    throw new Error(`speculativeShare must be in (0, 1], got ${speculative}`);
  }
  const capOf = (p: GmailPriority) =>
    p === "foreground"
      ? limit
      : p === "background"
        ? limit * share
        : limit * speculative;

  const charges: { at: number; units: number; priority: GmailPriority }[] = [];
  let windowUnits = 0;
  /** Background's own charges in the window: what its share counts. */
  let backgroundUnits = 0;
  let spentUnits = 0;
  let pausedUntil = 0;
  const queues: Record<GmailPriority, Waiter[]> = {
    foreground: [],
    background: [],
    speculative: [],
  };
  const anyQueued = () => PRIORITIES.some((p) => queues[p].length > 0);
  let timer: { handle: unknown; at: number } | null = null;

  function prune(now: number) {
    while (charges.length > 0 && charges[0]!.at + WINDOW_MS <= now) {
      const c = charges.shift()!;
      windowUnits -= c.units;
      if (c.priority === "background") backgroundUnits -= c.units;
    }
  }

  function charge(now: number, units: number, priority: GmailPriority) {
    charges.push({ at: now, units, priority });
    windowUnits += units;
    if (priority === "background") backgroundUnits += units;
    spentUnits += units;
  }

  /**
   * When `units` more fit under `cap` counting only `counted` charges (now if
   * they already do), as the oldest charges leave the window.
   */
  function roomAt(
    units: number,
    cap: number,
    used: number,
    counted: (c: (typeof charges)[number]) => boolean,
    now: number,
  ): number {
    let left = used;
    if (left + units <= cap) return now;
    for (const c of charges) {
      if (!counted(c)) continue;
      left -= c.units;
      if (left + units <= cap) return c.at + WINDOW_MS;
    }
    // Unreachable: acquire refuses a call larger than its cap.
    throw new Error(`quota pacer: ${units} units can never fit under ${cap}`);
  }

  const every = () => true;
  const ownBackground = (c: (typeof charges)[number]) =>
    c.priority === "background";

  /** When `priority`'s head of `units` is admissible: now, or the instant room opens. */
  function admissibleAt(
    priority: GmailPriority,
    units: number,
    now: number,
  ): number {
    switch (priority) {
      case "foreground":
        return roomAt(units, limit, windowUnits, every, now);
      case "background":
        return Math.max(
          roomAt(
            units,
            capOf("background"),
            backgroundUnits,
            ownBackground,
            now,
          ),
          roomAt(units, limit, windowUnits, every, now),
        );
      case "speculative":
        return roomAt(units, capOf("speculative"), windowUnits, every, now);
    }
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
      if (anyQueued()) arm(pausedUntil);
      return;
    }
    prune(now);
    for (;;) {
      // Strictly by priority: a head that does not fit holds every tier
      // below it too, so a lower tier never takes the room it waits for.
      const priority = PRIORITIES.find((p) => queues[p].length > 0);
      if (priority === undefined) return;
      const head = queues[priority][0]!;
      const at = admissibleAt(priority, head.units, now);
      if (at > now) {
        arm(at);
        return;
      }
      queues[priority].shift();
      head.detach();
      charge(now, head.units, priority);
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
        if (!settled && onQueued)
          endWait = onQueued(clock.now() < pausedUntil ? "paused" : "budget");
      });
    },
    pause(ms) {
      const until = clock.now() + ms;
      if (until <= pausedUntil) return;
      pausedUntil = until;
      if (anyQueued()) arm(pausedUntil);
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
          speculative: queues.speculative.length,
        },
        pausedForMs: now < pausedUntil ? pausedUntil - now : null,
      };
    },
  };
}
