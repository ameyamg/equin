import {
  clockOffset,
  type ClockOffset,
} from "@plugins/primitives/plugins/perfs/plugins/page-clock/core";

/** Which socket a recovery is on (the client's `SocketKind`). */
export type RecoverySocket = "worktree" | "central";

/**
 * One socket on its way back to live after it dropped: the socket is still
 * reconnecting, or it reopened and replayed its subs and some replayed read
 * has no answer yet. Until then the tab shows the values it held before the
 * drop, which may be stale.
 */
export interface LiveRecovery {
  socket: RecoverySocket;
  /** `Date.now()` at the drop. */
  droppedAt: number;
  /** `reconnecting`: the socket is not open again yet; `replaying`: it is, and replayed reads are still unanswered. */
  phase: "reconnecting" | "replaying";
  /** How many reads the replay asked for again (0 while reconnecting). */
  replayed: number;
}

/** A recovery that ended: every replayed read answered. */
export interface LiveRecoveryEnd {
  socket: RecoverySocket;
  droppedAt: number;
  /** `Date.now()` at the last replayed answer. */
  endedAt: number;
  /**
   * Drop → last replayed answer on the performance clock, which pauses while
   * the machine sleeps: the awake time the tab waited.
   */
  awakeMs: number;
  /**
   * How long the machine slept from the last frame heard on the socket before
   * the drop to the end (the wall clock gained on the performance clock): a
   * drop a sleep caused, or a recovery a sleep interrupted. 0: none.
   */
  sleptMs: number;
  replayed: number;
  /** The socket dropped again before every replayed read was answered. */
  reopens: number;
  /**
   * Replayed reads given up on rather than answered: the client's
   * unanswered-sub deadline reported them lost. The recovery ended there, so
   * its duration is a lower bound.
   */
  unanswered: number;
}

export type LiveRecoveryEvent =
  | { kind: "start"; recovery: LiveRecovery }
  | { kind: "replaying"; recovery: LiveRecovery }
  /** Dropped again mid-replay: waiting for the next open's replay. */
  | { kind: "reconnecting"; recovery: LiveRecovery }
  | { kind: "end"; end: LiveRecoveryEnd };

interface Episode {
  droppedAt: number;
  droppedPerf: number;
  /** Clock offset at the last frame heard before the drop (or at the drop, if none was). */
  offsetBefore: ClockOffset;
  /** Sub id → the request id its replayed entry (or a resend) was sent under. */
  pending: Map<string, number>;
  /** Sub id → its resource key, for naming what is still pending. */
  keys: Map<string, string>;
  replayed: number;
  reopens: number;
  unanswered: number;
  view: LiveRecovery;
}

/**
 * The per-socket recovery record of one `NotificationsClient`: told of every
 * drop, replay, answer, resend and release by the client, it says when each
 * socket is live again (`end`) and what is still pending meanwhile. Pure
 * bookkeeping — no timer, no socket of its own.
 */
export class RecoveryTracker {
  private readonly episodes = new Map<RecoverySocket, Episode>();
  private readonly lastHeard = new Map<RecoverySocket, ClockOffset>();
  private readonly listeners = new Set<(e: LiveRecoveryEvent) => void>();
  private snapshot: readonly LiveRecovery[] = [];

  /** A frame arrived on `socket` — the last moment it was known alive. */
  noteHeard(socket: RecoverySocket): void {
    this.lastHeard.set(socket, clockOffset());
  }

  /** `socket` left `open` after having been open. */
  noteDrop(socket: RecoverySocket): void {
    const ep = this.episodes.get(socket);
    if (ep !== undefined) {
      // Dropped again before it was live: the recovery goes on from the first
      // drop and waits for the next replay.
      if (ep.view.phase === "replaying") {
        ep.reopens++;
        ep.pending.clear();
        ep.keys.clear();
        ep.replayed = 0;
        this.setView(socket, ep, "reconnecting");
      }
      return;
    }
    const droppedAt = Date.now();
    const episode: Episode = {
      droppedAt,
      droppedPerf: performance.now(),
      offsetBefore: this.lastHeard.get(socket) ?? clockOffset(),
      pending: new Map(),
      keys: new Map(),
      replayed: 0,
      reopens: 0,
      unanswered: 0,
      view: { socket, droppedAt, phase: "reconnecting", replayed: 0 },
    };
    this.episodes.set(socket, episode);
    this.publish();
    this.emit({ kind: "start", recovery: episode.view });
  }

  /**
   * `socket` replayed its subs: `entries` are the reads that have a reader,
   * each with the request id it was sent under. A replay outside a recovery
   * (the missed-update probe's resync) is not one. A replay while one is
   * already replaying (that probe, mid-recovery) re-asks the reads still
   * pending under new ids.
   */
  noteReplay(
    socket: RecoverySocket,
    entries: readonly { sub: string; key: string; id: number }[],
  ): void {
    const ep = this.episodes.get(socket);
    if (ep === undefined) return;
    if (ep.view.phase === "replaying") {
      for (const e of entries)
        if (ep.pending.has(e.sub)) ep.pending.set(e.sub, e.id);
      return;
    }
    for (const e of entries) {
      ep.pending.set(e.sub, e.id);
      ep.keys.set(e.sub, e.key);
    }
    ep.replayed = entries.length;
    this.setView(socket, ep, "replaying");
    this.endIfDone(socket, ep);
  }

  /** `sub` was asked again under request `id` (a forced resub): that answer is the one awaited now. */
  noteResent(socket: RecoverySocket, sub: string, id: number): void {
    const ep = this.episodes.get(socket);
    if (ep?.pending.has(sub) === true) ep.pending.set(sub, id);
  }

  /** The answer to request `id` for `sub` arrived (a sub-ack, an up-to-date, a sub-error). */
  noteAnswered(
    socket: RecoverySocket,
    sub: string,
    id: number | undefined,
  ): void {
    const ep = this.episodes.get(socket);
    if (ep === undefined || id === undefined) return;
    if (ep.pending.get(sub) !== id) return;
    ep.pending.delete(sub);
    this.endIfDone(socket, ep);
  }

  /**
   * `sub`'s request was given up on: the unanswered-sub deadline reported it
   * lost. Its answer is no longer waited for, so one lost answer cannot hold
   * the recovery open (and the Connection row on "Catching up") for good.
   */
  noteAbandoned(socket: RecoverySocket, sub: string): void {
    const ep = this.episodes.get(socket);
    if (ep === undefined || !ep.pending.delete(sub)) return;
    ep.unanswered++;
    this.endIfDone(socket, ep);
  }

  /** `sub` was released: nobody waits for its answer any more. */
  noteReleased(socket: RecoverySocket, sub: string): void {
    const ep = this.episodes.get(socket);
    if (ep === undefined || !ep.pending.delete(sub)) return;
    this.endIfDone(socket, ep);
  }

  /** Every socket still recovering — the same array until one starts, moves phase or ends. */
  getRecoveries(): readonly LiveRecovery[] {
    return this.snapshot;
  }

  /**
   * The reads `socket`'s replay still waits for, as `key` or `key×n` (n
   * tuples of one resource), most tuples first, at most `max`. Empty while
   * reconnecting (nothing was replayed yet) or when none is in progress.
   */
  pendingKeys(socket: RecoverySocket, max: number): string[] {
    const ep = this.episodes.get(socket);
    if (ep === undefined) return [];
    const counts = new Map<string, number>();
    for (const sub of ep.pending.keys()) {
      const key = ep.keys.get(sub) ?? sub;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, max)
      .map(([key, n]) => (n > 1 ? `${key}×${n}` : key));
  }

  /**
   * How long the machine has slept since the last frame heard on `socket`
   * before its current recovery's drop (0 with none in progress).
   */
  sleptSinceDrop(socket: RecoverySocket): number {
    const ep = this.episodes.get(socket);
    return ep === undefined ? 0 : sleptSince(ep.offsetBefore);
  }

  subscribe(listener: (e: LiveRecoveryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private endIfDone(socket: RecoverySocket, ep: Episode): void {
    if (ep.view.phase !== "replaying" || ep.pending.size > 0) return;
    this.episodes.delete(socket);
    this.publish();
    this.emit({
      kind: "end",
      end: {
        socket,
        droppedAt: ep.droppedAt,
        endedAt: Date.now(),
        awakeMs: Math.max(0, performance.now() - ep.droppedPerf),
        sleptMs: sleptSince(ep.offsetBefore),
        replayed: ep.replayed,
        reopens: ep.reopens,
        unanswered: ep.unanswered,
      },
    });
  }

  private setView(
    socket: RecoverySocket,
    ep: Episode,
    phase: LiveRecovery["phase"],
  ): void {
    ep.view = { socket, droppedAt: ep.droppedAt, phase, replayed: ep.replayed };
    this.publish();
    this.emit({ kind: phase, recovery: ep.view });
  }

  private publish(): void {
    this.snapshot = [...this.episodes.values()].map((e) => e.view);
  }

  private emit(event: LiveRecoveryEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

// The wall clock runs through a sleep and the performance clock does not
// (page-clock): the offset between them grows by exactly the time slept.
// Under a millisecond of the difference is the two clocks' reads, not a sleep.
function sleptSince(before: ClockOffset): number {
  const grown = clockOffset() - before;
  return grown >= 1 ? grown : 0;
}
