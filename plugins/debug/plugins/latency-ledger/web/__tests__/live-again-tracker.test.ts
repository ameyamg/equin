// The ledger's half of a reconnect: one `reconnect` sample per recovery, and
// one "not live again" report for a recovery still pending at its budget —
// never for a tab hidden in it or a machine that slept.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LiveRecoveryEvent,
  LiveStateSocketKind,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  RECOVERY_CAP_MS,
  STILL_RECONNECTING,
  startLiveAgainTracking,
  type NotLiveAgain,
} from "../internal/live-again-tracker";
import { userWaitDuring } from "@plugins/debug/plugins/slow-ops/plugins/sink/core";
import { __resetUserWaits } from "@plugins/debug/plugins/slow-ops/plugins/sink/core/testing";

let hidden = false;
vi.mock(
  "@plugins/primitives/plugins/perfs/plugins/page-pauses/web",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    pausesDuring: () => ({ hiddenMs: hidden ? 1 : 0, stalledMs: 0 }),
  }),
);
vi.mock("@plugins/primitives/plugins/log-channels/web", async (orig) => ({
  ...(await orig<object>()),
  clientLog: () => {},
}));
vi.mock("@plugins/primitives/plugins/pane/web", async (orig) => ({
  ...(await orig<object>()),
  peekRoutePattern: () => "/agents/c/:convId",
}));

function fakeSource() {
  let listener: ((e: LiveRecoveryEvent) => void) | null = null;
  const state = { pending: ["a×2", "b"], sleptMs: 0 };
  return {
    state,
    emit: (e: LiveRecoveryEvent) => listener?.(e),
    source: {
      subscribeRecovery: (fn: (e: LiveRecoveryEvent) => void) => {
        listener = fn;
        return () => {
          listener = null;
        };
      },
      recoveryPendingKeys: (_s: LiveStateSocketKind, max: number) =>
        state.pending.slice(0, max),
      recoverySleptMs: () => state.sleptMs,
    },
  };
}

const start = (droppedAt = Date.now()): LiveRecoveryEvent => ({
  kind: "start",
  recovery: {
    socket: "worktree",
    droppedAt,
    phase: "reconnecting",
    replayed: 0,
  },
});
const replaying = (): LiveRecoveryEvent => ({
  kind: "replaying",
  recovery: {
    socket: "worktree",
    droppedAt: 0,
    phase: "replaying",
    replayed: 3,
  },
});
const end = (
  awakeMs: number,
  sleptMs = 0,
  unanswered = 0,
): LiveRecoveryEvent => ({
  kind: "end",
  end: {
    socket: "worktree",
    droppedAt: Date.now() - awakeMs,
    endedAt: Date.now(),
    awakeMs,
    sleptMs,
    replayed: 3,
    reopens: 0,
    unanswered,
  },
});

describe("live-again tracking", () => {
  let told: NotLiveAgain[];
  let samples: [number, { censored: boolean; excluded: boolean }][];
  let stop: () => void;
  let fake: ReturnType<typeof fakeSource>;

  beforeEach(() => {
    vi.useFakeTimers();
    told = [];
    samples = [];
    fake = fakeSource();
    stop = startLiveAgainTracking(fake.source, {
      budgetMs: () => 10_000,
      maxWaitingFor: 8,
      onNotLive: (i) => told.push(i),
      onSample: (ms, f) => samples.push([ms, f]),
    });
  });
  afterEach(() => {
    stop();
    hidden = false;
    vi.useRealTimers();
    __resetUserWaits();
  });

  it("records a recovery that ended under its budget, and tells nothing", () => {
    fake.emit(start());
    fake.emit(replaying());
    vi.advanceTimersByTime(3_000);
    fake.emit(end(3_100));
    vi.advanceTimersByTime(20_000);
    expect(samples).toEqual([[3_100, { censored: false, excluded: false }]]);
    expect(told).toEqual([]);
  });

  it("tells a recovery still replaying at its budget, naming the reads it waits for", () => {
    fake.emit(start());
    fake.emit(replaying());
    vi.advanceTimersByTime(10_001);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      route: "/agents/c/:convId",
      socket: "worktree",
      budgetMs: 10_000,
      waitingFor: ["a×2", "b"],
    });
    expect(told[0]!.elapsedMs).toBeGreaterThanOrEqual(10_000);
  });

  it("names the socket while it has not reopened", () => {
    fake.emit(start());
    vi.advanceTimersByTime(10_001);
    expect(told[0]?.waitingFor).toEqual([STILL_RECONNECTING]);
  });

  it("never tells a hidden tab or a slept machine; their samples are excluded", () => {
    hidden = true;
    fake.emit(start());
    vi.advanceTimersByTime(10_001);
    expect(told).toEqual([]);
    fake.emit(end(12_000));
    expect(samples).toEqual([[12_000, { censored: false, excluded: true }]]);

    hidden = false;
    fake.state.sleptMs = 30_000;
    fake.emit(start());
    vi.advanceTimersByTime(10_001);
    expect(told).toEqual([]);
    fake.emit(end(11_000, 30_000));
    expect(samples.at(-1)).toEqual([
      11_000,
      { censored: false, excluded: true },
    ]);
  });

  it("records a recovery past the cap as censored, once", () => {
    fake.emit(start());
    vi.advanceTimersByTime(RECOVERY_CAP_MS + 1);
    expect(samples).toEqual([
      [RECOVERY_CAP_MS, { censored: true, excluded: false }],
    ]);
    fake.emit(end(70_000));
    expect(samples).toHaveLength(1);
  });

  it("names the socket again once it dropped mid-replay", () => {
    fake.emit(start());
    fake.emit(replaying());
    fake.emit({
      kind: "reconnecting",
      recovery: {
        socket: "worktree",
        droppedAt: 0,
        phase: "reconnecting",
        replayed: 0,
      },
    });
    vi.advanceTimersByTime(10_001);
    expect(told[0]?.waitingFor).toEqual([STILL_RECONNECTING]);
  });

  it("a recovery that ended by giving up on a read is a lower bound", () => {
    fake.emit(start());
    fake.emit(replaying());
    fake.emit(end(16_000, 0, 1));
    expect(samples).toEqual([[16_000, { censored: true, excluded: false }]]);
  });

  it("a recovery is a user wait: its report names it, its items fall in it", () => {
    const droppedAt = Date.now();
    fake.emit(start(droppedAt));
    fake.emit(replaying());
    vi.advanceTimersByTime(10_001);
    const wait = userWaitDuring(droppedAt + 1_000, droppedAt + 2_000);
    expect(wait?.kind).toBe("live-again");
    expect(told[0]?.wait).toEqual({ waitId: wait!.id, startedAt: droppedAt });
    fake.emit(end(12_000));
    // Ended: an item after it is not during it.
    expect(
      userWaitDuring(Date.now() + 1_000, Date.now() + 2_000),
    ).toBeUndefined();
  });

  it("a recovery in a hidden tab holds nothing once it ends", () => {
    hidden = true;
    const droppedAt = Date.now();
    fake.emit(start(droppedAt));
    fake.emit(end(3_000));
    expect(userWaitDuring(droppedAt, droppedAt + 1)).toBeUndefined();
  });
});
