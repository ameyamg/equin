import type {
  LiveRecoveryEnd,
  LiveRecoveryEvent,
  LiveStateSocketKind,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import { pausesDuring } from "@plugins/primitives/plugins/perfs/plugins/page-pauses/web";
import { peekRoutePattern } from "@plugins/primitives/plugins/pane/web";
import { clientLog } from "@plugins/primitives/plugins/log-channels/web";

// How long a tab takes to be live again after its socket dropped: drop → every
// read the reconnect replayed answered (live-state's recovery). Recorded as the
// `reconnect` metric, and reported once per drop that is still not live at its
// budget.

/** A recovery still pending at its budget: what it waits for. */
export interface NotLiveAgain {
  /** The route pattern the tab shows (`peekRoutePattern`). */
  route: string;
  socket: LiveStateSocketKind;
  /** Drop → now, awake time: the budget, give or take a timer's lateness. */
  elapsedMs: number;
  budgetMs: number;
  /** The replayed reads still unanswered (`key×n`), or the socket still reconnecting. */
  waitingFor: string[];
}

/** The part of the live-state client this tracker reads. */
export interface RecoverySource {
  subscribeRecovery(listener: (e: LiveRecoveryEvent) => void): () => void;
  recoveryPendingKeys(socket: LiveStateSocketKind, max: number): string[];
  recoverySleptMs(socket: LiveStateSocketKind): number;
}

export interface LiveAgainHooks {
  /** The budget, ms from the drop — read as each recovery begins. */
  budgetMs: () => number;
  /** Max reads named in a report. */
  maxWaitingFor: number;
  onNotLive: (info: NotLiveAgain) => void;
  /** One sample per recovery: its awake duration, censored at the cap, excluded when hidden or slept through. */
  onSample: (
    ms: number,
    flags: { censored: boolean; excluded: boolean },
  ) => void;
}

/** A recovery still waiting after this long is recorded as "at least this long". */
export const RECOVERY_CAP_MS = 60_000;
/**
 * More sleep than this since the last frame heard before the drop: the drop
 * was the sleep's (or the wake's), and its span measures the machine's nap,
 * not the app. Under it is the clocks' own jitter.
 */
export const RECOVERY_SLEEP_MS = 1_000;

/** What the report names while the socket has not reopened yet. */
export const STILL_RECONNECTING = "the socket (still reconnecting)";

interface Active {
  droppedAt: number;
  droppedPerf: number;
  budgetTimer: ReturnType<typeof setTimeout> | null;
  capTimer: ReturnType<typeof setTimeout>;
  replaying: boolean;
}

/**
 * Follow `source`'s recoveries. Returns the teardown.
 */
export function startLiveAgainTracking(
  source: RecoverySource,
  hooks: LiveAgainHooks,
): () => void {
  const active = new Map<LiveStateSocketKind, Active>();

  const excludedFor = (
    droppedAt: number,
    end: number,
    sleptMs: number,
  ): { hidden: boolean; slept: boolean } => ({
    hidden: pausesDuring(droppedAt, end).hiddenMs > 0,
    slept: sleptMs > RECOVERY_SLEEP_MS,
  });

  const finish = (socket: LiveStateSocketKind, a: Active): void => {
    if (a.budgetTimer !== null) clearTimeout(a.budgetTimer);
    clearTimeout(a.capTimer);
    active.delete(socket);
  };

  const onEnd = (end: LiveRecoveryEnd): void => {
    const a = active.get(end.socket);
    // Ended after the cap already recorded it, or began before tracking did.
    if (a === undefined) return;
    finish(end.socket, a);
    const x = excludedFor(end.droppedAt, end.endedAt, end.sleptMs);
    // A read given up on (reported unanswered) ended the wait without an
    // answer: the duration is a lower bound.
    hooks.onSample(end.awakeMs, {
      censored: end.unanswered > 0,
      excluded: x.hidden || x.slept,
    });
    clientLog(
      "latency-ledger",
      `reconnect ${Math.round(end.awakeMs)}ms socket=${end.socket} route=${peekRoutePattern()} replayed=${end.replayed}` +
        (end.reopens > 0 ? ` reopens=${end.reopens}` : "") +
        (end.unanswered > 0 ? ` unanswered=${end.unanswered}` : "") +
        (x.hidden ? " hidden" : "") +
        (x.slept ? ` slept=${Math.round(end.sleptMs)}ms` : ""),
    );
  };

  const unsubscribe = source.subscribeRecovery((e) => {
    if (e.kind === "end") {
      onEnd(e.end);
      return;
    }
    const socket = e.recovery.socket;
    if (e.kind === "replaying" || e.kind === "reconnecting") {
      const a = active.get(socket);
      if (a !== undefined) a.replaying = e.kind === "replaying";
      return;
    }
    const droppedPerf = performance.now();
    const budget = hooks.budgetMs();
    const a: Active = {
      droppedAt: e.recovery.droppedAt,
      droppedPerf,
      budgetTimer: null,
      replaying: false,
      capTimer: setTimeout(() => {
        if (active.get(socket) !== a) return;
        finish(socket, a);
        const now = Date.now();
        const x = excludedFor(a.droppedAt, now, source.recoverySleptMs(socket));
        hooks.onSample(RECOVERY_CAP_MS, {
          censored: true,
          excluded: x.hidden || x.slept,
        });
        clientLog(
          "latency-ledger",
          `reconnect CENSORED ${RECOVERY_CAP_MS}ms socket=${socket} route=${peekRoutePattern()} waiting-for=[${(a.replaying ? source.recoveryPendingKeys(socket, hooks.maxWaitingFor) : [STILL_RECONNECTING]).join(", ")}]`,
        );
      }, RECOVERY_CAP_MS),
    };
    // Once, at the budget: a recovery still pending in a tab that stayed
    // visible and a machine that stayed awake is told, with what it waits for.
    a.budgetTimer = setTimeout(
      () => {
        a.budgetTimer = null;
        if (active.get(socket) !== a) return;
        if (document.visibilityState === "hidden") return;
        const x = excludedFor(
          a.droppedAt,
          Date.now(),
          source.recoverySleptMs(socket),
        );
        if (x.hidden || x.slept) return;
        hooks.onNotLive({
          route: peekRoutePattern(),
          socket,
          elapsedMs: performance.now() - a.droppedPerf,
          budgetMs: budget,
          waitingFor: a.replaying
            ? source.recoveryPendingKeys(socket, hooks.maxWaitingFor)
            : [STILL_RECONNECTING],
        });
        // Rounded up: a timer may fire up to ~1 ms early against
        // `performance.now()`, and an item under its budget is dropped.
      },
      Math.ceil(budget) + 1,
    );
    active.set(socket, a);
  });

  return () => {
    unsubscribe();
    for (const [socket, a] of active) finish(socket, a);
  };
}
