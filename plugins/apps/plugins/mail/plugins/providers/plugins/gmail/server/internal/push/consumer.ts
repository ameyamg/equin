/** The consumer's state, as the provider contract's MailPushState spells it (minus not-set-up). */
export type PushConsumerState =
  | { kind: "starting" }
  | { kind: "live"; since: string }
  | { kind: "down"; since: string; message: string };

export type PushConsumerDeps = {
  /**
   * Makes the subscription ready to pull (creates it when missing) — run at
   * the start and again after any failure, so `live` always means a request
   * with this backend's token just reached the subscription.
   */
  prepare: () => Promise<void>;
  /** One held pull: messages as they arrive, or `gone` (the subscription no longer exists). Rejects when `signal` aborts. */
  pull: (
    signal: AbortSignal,
  ) => Promise<{ kind: "messages"; ackIds: string[] } | { kind: "gone" }>;
  ack: (ackIds: readonly string[]) => Promise<void>;
  /** The account changed (a notification arrived). */
  changed: () => void;
  onState: (s: PushConsumerState) => void;
  /** A wait the signal cuts short (resolving, not rejecting). */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Calls `fn` after `ms` unless cancelled (the pull's bound). */
  after: (ms: number, fn: () => void) => () => void;
  now: () => number;
};

/**
 * A held pull that answers empty sooner than this was not held: refused
 * (down, then the backoff), so a server that stops holding cannot turn the
 * loop into polling.
 */
export const MIN_HELD_EMPTY_MS = 5_000;
/**
 * The longest one held pull may stay open before it is cut and sent again —
 * the bound around a network peer: a connection that died without a reset
 * (a sleep, a network switch) would otherwise hold `live` forever while
 * nothing arrives. A cut pull is not a failure (Pub/Sub may hold that long);
 * the next one finds out whether the connection works. A notification a cut
 * pull was carrying is redelivered after its ack deadline.
 */
export const PULL_BOUND_MS = 60_000;
/** The reconnect wait after the n-th failure in a row: 1 s doubling to 60 s. */
export function reconnectDelayMs(failures: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, failures - 1));
}

/**
 * The pull consumer: prepare, then held pulls back to back — each answers as
 * soon as a notification is published (Gmail: at most one a second per
 * user), so a change reaches `changed` within the pull's round trip. Every
 * batch is signalled before it is acked (a lost ack is a redelivery: one
 * more sync step, harmless). A failure (offline, a refusal, the subscription
 * gone) is `down` with its message, then a reconnect after
 * `reconnectDelayMs` — the bound around Google, which we do not control —
 * and `live` again once a pull answers.
 * `stop()` aborts the pull in flight and resolves once the loop ended.
 */
export function startPushConsumer(deps: PushConsumerDeps): {
  stop: () => Promise<void>;
} {
  const ac = new AbortController();
  const iso = () => new Date(deps.now()).toISOString();
  let failures = 0;
  let prepared = false;
  /** When the current outage began (a run of failures keeps its first instant). */
  let downSince: string | null = null;

  function markLive(): void {
    failures = 0;
    downSince = null;
    deps.onState({ kind: "live", since: iso() });
  }

  async function once(): Promise<void> {
    if (!prepared) {
      await deps.prepare();
      prepared = true;
      // First connect: the subscription answered, the held pull starts now.
      // After a failure, live waits for a pull that answers — a prepare that
      // works while the pull keeps failing must not reset the backoff.
      if (failures === 0) markLive();
    }
    const t0 = deps.now();
    // The pull's own signal: aborted by stop() or by the bound.
    const pullAc = new AbortController();
    const onStop = () => pullAc.abort(ac.signal.reason);
    ac.signal.addEventListener("abort", onStop, { once: true });
    let cut = false;
    const cancelBound = deps.after(PULL_BOUND_MS, () => {
      cut = true;
      pullAc.abort(new Error("held pull cut at its bound"));
    });
    let r: Awaited<ReturnType<PushConsumerDeps["pull"]>>;
    try {
      r = await deps.pull(pullAc.signal);
    } catch (err) {
      if (!cut || ac.signal.aborted) throw err;
      // Held to the bound without failing: the subscription answered the
      // prepare and held the pull — send it again (on a fresh connection,
      // the cut one closed).
      if (failures > 0) markLive();
      return;
    } finally {
      cancelBound();
      ac.signal.removeEventListener("abort", onStop);
    }
    if (r.kind === "gone")
      throw new Error(
        "the pull subscription no longer exists (deleted, or expired after a day unused)",
      );
    if (r.ackIds.length === 0 && deps.now() - t0 < MIN_HELD_EMPTY_MS)
      throw new Error(
        `Pub/Sub answered an empty pull after ${deps.now() - t0} ms instead of holding it`,
      );
    if (r.ackIds.length > 0) {
      deps.changed();
      await deps.ack(r.ackIds);
    }
    // A pull answered (and its batch acked): the subscription delivers.
    if (failures > 0) markLive();
  }

  const loop = (async () => {
    deps.onState({ kind: "starting" });
    while (!ac.signal.aborted) {
      try {
        await once();
      } catch (err) {
        if (ac.signal.aborted) break;
        prepared = false;
        failures++;
        downSince ??= iso();
        deps.onState({
          kind: "down",
          since: downSince,
          message: err instanceof Error ? err.message : String(err),
        });
        await deps.sleep(reconnectDelayMs(failures), ac.signal);
      }
    }
  })();

  return {
    stop: async () => {
      ac.abort(new Error("push consumer stopped"));
      await loop;
    },
  };
}

/** `fn` after `ms`, cancellable: the pull's bound. */
export function afterMs(ms: number, fn: () => void): () => void {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
}

/** A wait that `signal` ends early (resolving). */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
