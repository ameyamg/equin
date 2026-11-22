/**
 * How a queued caller's wait is metered: shown from the moment it queues behind
 * a run of its key, charged as its own turn comes (or it gives up). Installed by
 * the process's profiler at boot (`runtime-profiler/server` installs
 * `beginWait(layer, "queue")`) — this primitive cannot import the profiler. With
 * none installed (a browser, a CLI, a test), nothing.
 */
export type KeyedMutexWaitMeter = (layer: string) => () => void;

const NO_WAIT_END = (): void => {};
let waitMeter: KeyedMutexWaitMeter = () => NO_WAIT_END;

/** Install the meter every queued caller reports to (see {@link KeyedMutexWaitMeter}). */
export function installKeyedMutexWaitMeter(
  meter: KeyedMutexWaitMeter | null,
): void {
  waitMeter = meter ?? (() => NO_WAIT_END);
}

/**
 * A per-key FIFO mutex: `run(key, fn)` starts `fn` only once every earlier
 * `run` for the same key has settled, in the order the calls arrived. Different
 * keys never wait on each other.
 *
 * Unlike `packages/coalesce` (which FOLDS triggers into one trailing run) and
 * `packages/inflight` (which SHARES one execution among concurrent callers),
 * every call here runs its own `fn` exactly once — for mutations that must not
 * interleave, such as keystrokes typed into one terminal.
 *
 * In-process only: it orders callers inside one process, never across two.
 */
export interface KeyedMutex {
  /**
   * Run `fn` once every earlier run for `key` has settled. With `signal`, a
   * call still WAITING when it aborts rejects with `signal.reason` and
   * never runs `fn` — the calls queued behind it still wait for the runs ahead
   * of it, so giving up never lets two runs of one key overlap. An abort once
   * `fn` has started is `fn`'s own business.
   */
  run<T>(
    key: string,
    fn: () => Promise<T>,
    opts?: { signal?: AbortSignal },
  ): Promise<T>;
  /** Keys with a run in flight or queued — 0 once everything settled. */
  readonly size: number;
}

/**
 * Wait for the runs ahead to settle (`"turn"`), or for `signal` to abort
 * first (`"aborted"`).
 *
 * A queued waiter holds no use-scoped gate slot while it waits (inside the live
 * read gate a slot is held only around a DB statement, file call or child
 * process — `packages/semaphore`), so waiters can never fill the gate in front
 * of the holder's next use (main, 2026-11-17: three `cost-at` reads queued on
 * their conversation's key held the resource's whole read share for good).
 */
async function waitForTurn(
  previous: Promise<void>,
  signal: AbortSignal | undefined,
): Promise<"turn" | "aborted"> {
  if (signal?.aborted) return "aborted";
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<"aborted">((resolve) => {
    if (!signal) return;
    onAbort = () => resolve("aborted");
    signal.addEventListener("abort", onAbort, { once: true });
  });
  // The previous tail never rejects (it is our own `release`), so the chain is
  // ordering only: fn's own outcome goes to its caller alone.
  const wait = Promise.race([previous.then(() => "turn" as const), aborted]);
  try {
    return await wait;
  } finally {
    if (onAbort) signal!.removeEventListener("abort", onAbort);
  }
}

/**
 * `name` says what the mutex orders: a caller queued behind another run of its
 * key is shown and charged as the `mutex:<name>` wait (see
 * {@link installKeyedMutexWaitMeter}), so the request that waited names the lock
 * it sat on instead of booking the holder's time as its own work. Required: an
 * unnamed lock is the wait no trace can explain (2026-11-22, a rewind queued
 * 25 s behind a Stop on the agent-lifecycle lock read as 26 s of "own" time).
 * An uncontended run meters nothing.
 */
export function createKeyedMutex(name: string): KeyedMutex {
  const waitLayer = `mutex:${name}`;
  // key → the tail of its queue: a promise that settles when the LAST queued
  // run settles. A run chains onto the tail it found; the entry is deleted only
  // by the run that is still the tail when it settles, so an idle key holds
  // nothing.
  const tails = new Map<string, Promise<void>>();

  return {
    run<T>(
      key: string,
      fn: () => Promise<T>,
      opts?: { signal?: AbortSignal },
    ): Promise<T> {
      const signal = opts?.signal;
      const ahead = tails.get(key);
      const previous = ahead ?? Promise.resolve();
      let release!: () => void;
      const tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      tails.set(key, tail);
      const settle = () => {
        if (tails.get(key) === tail) tails.delete(key);
        release();
      };
      return (async () => {
        let turn: "turn" | "aborted";
        // Only a caller with a run ahead of it waits: announced here (the
        // body runs synchronously up to its first await, in the caller's own
        // async context), ended as its turn comes or it gives up — inside the
        // `try`, so a meter that throws never leaves the key held.
        let endWait = NO_WAIT_END;
        try {
          if (ahead) endWait = waitMeter(waitLayer);
          turn = await waitForTurn(previous, signal);
        } catch (err) {
          // Never leave the key held by a call that will not run.
          void previous.then(settle);
          throw err;
        } finally {
          endWait();
        }
        // Aborted while waiting (or as its turn came): it never runs. The calls behind it wait for the runs
        // ahead of it, so giving up never lets two runs of one key overlap.
        if (turn === "aborted" || signal?.aborted) {
          void previous.then(settle);
          throw signal!.reason;
        }
        try {
          return await fn();
        } finally {
          settle();
        }
      })();
    },
    get size() {
      return tails.size;
    },
  };
}
