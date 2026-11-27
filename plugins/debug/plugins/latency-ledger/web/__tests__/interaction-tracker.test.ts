// A page that unloads before its lists settle must still leave its page load:
// it is the only trace a tab reloading faster than it loads leaves.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Interaction } from "../../core";
import {
  cutActiveInteraction,
  startInteractionTracking,
  type NotReady,
} from "../internal/interaction-tracker";
import { userWaitDuring } from "@plugins/debug/plugins/slow-ops/plugins/sink/core";
import { __resetUserWaits } from "@plugins/debug/plugins/slow-ops/plugins/sink/core/testing";

let pending = 1;
vi.mock(
  "@plugins/network/plugins/live/plugins/live-state/web",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    pendingMountSnapshot: () => ({
      pending,
      startedTotal: 3,
      pendingKeys: ["tasks"],
      lastReleasedKey: null,
    }),
    subscribePendingMounts: () => () => {},
  }),
);
vi.mock("@plugins/primitives/plugins/pane/web", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  currentRoutePath: () => "/demo/site/x;view.list=all~AAAA",
  peekRoutePattern: () => "/demo/site/:id",
}));
vi.mock(
  "@plugins/primitives/plugins/log-channels/web",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    clientLog: () => {},
  }),
);

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  pending = 1;
  __resetUserWaits();
});

describe("cutActiveInteraction", () => {
  it("records an unsettled page load as censored", () => {
    const seen: Interaction[] = [];
    stop = startInteractionTracking((i) => seen.push(i));
    expect(seen).toEqual([]);
    cutActiveInteraction();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      kind: "page-load",
      route: "/demo/site/:id",
      placeKey: expect.stringMatching(/^[0-9a-f]{28}$/),
      censored: true,
    });
    // Once recorded, a second cut records nothing more.
    cutActiveInteraction();
    expect(seen).toHaveLength(1);
  });
});

// The tracker measures from `performance.now()`: fake it with the timers.
const fakeClock = () =>
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "performance"],
  });

describe("ready budget", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const budget = (ms: number, late: NotReady[]) => ({
    budgetMs: () => ms,
    onNotReady: (info: NotReady) => late.push(info),
  });

  it("names what a page load still waits for at its budget, once", () => {
    fakeClock();
    const late: NotReady[] = [];
    stop = startInteractionTracking(() => {}, budget(5000, late));
    vi.advanceTimersByTime(4999);
    expect(late).toEqual([]);
    // Armed a millisecond past the budget, never under it.
    vi.advanceTimersByTime(2);
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({
      route: "/demo/site/:id",
      budgetMs: 5000,
      waitingFor: ["tasks"],
    });
    vi.advanceTimersByTime(20_000);
    expect(late).toHaveLength(1);
  });

  it("says nothing for a page load that settled before its budget", () => {
    fakeClock();
    pending = 0;
    const late: NotReady[] = [];
    stop = startInteractionTracking(() => {}, budget(5000, late));
    vi.advanceTimersByTime(10_000);
    expect(late).toEqual([]);
  });

  it("tells a load quiet at its budget once it ends past it, with what answered last", () => {
    // A slow bundle: the tracker starts 6 s after navigation start, before
    // any read has mounted. The load is quiet at its (already past) budget,
    // so it is told when it ends — 6 s, past the budget.
    fakeClock();
    vi.advanceTimersByTime(6000);
    pending = 0;
    const late: NotReady[] = [];
    stop = startInteractionTracking(() => {}, budget(5000, late));
    vi.advanceTimersByTime(10);
    expect(late).toEqual([]);
    vi.advanceTimersByTime(500);
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ done: true, budgetMs: 5000 });
    expect(late[0]!.elapsedMs).toBeGreaterThanOrEqual(6000);
  });

  it("a page load is a user wait: its report names it; a navigation opens none", () => {
    fakeClock();
    const late: NotReady[] = [];
    stop = startInteractionTracking(() => {}, budget(5000, late));
    const now = Date.now();
    const wait = userWaitDuring(now, now + 1);
    expect(wait?.kind).toBe("page-load");
    vi.advanceTimersByTime(5001);
    expect(late[0]?.wait.waitId).toBe(wait!.id);
    // A navigation cuts the load short (its wait ends) and opens no wait.
    window.dispatchEvent(new Event("shell:navigate"));
    expect(
      userWaitDuring(Date.now() + 1_000, Date.now() + 2_000),
    ).toBeUndefined();
  });
});
