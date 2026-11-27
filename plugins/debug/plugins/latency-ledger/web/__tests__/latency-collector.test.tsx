// The collector feeds the ledger's `update-e2e` metric from the `update`
// latency signal's total — one subscriber on clientLatencySink among several.
// A sample the tab spent hidden in is kept but excluded; other signals are not recorded.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { clientLatencySink } from "@plugins/primitives/plugins/perfs/plugins/latency-signal/core";
import { flushOnPageHide, recordSample } from "../internal/client-ledger";
import {
  cutActiveInteraction,
  type ReadyBudget,
} from "../internal/interaction-tracker";
import { clientSlowOpSink } from "@plugins/debug/plugins/slow-ops/plugins/sink/core";
import type { LiveAgainHooks } from "../internal/live-again-tracker";

type ClientSlowOpSignal = Parameters<typeof clientSlowOpSink.emit>[0];
import { LatencyCollector } from "../components/latency-collector";

const order: string[] = [];
vi.mock("../internal/client-ledger", () => ({
  recordSample: vi.fn(),
  recordInteraction: vi.fn(),
  flushOnPageHide: vi.fn(() => order.push("flush")),
}));
let readyBudget: ReadyBudget | undefined;
vi.mock("../internal/interaction-tracker", () => ({
  startInteractionTracking: (_: unknown, ready?: ReadyBudget) => {
    readyBudget = ready;
    return () => {};
  },
  cutActiveInteraction: vi.fn(() => order.push("cut")),
}));
let liveAgain: LiveAgainHooks | undefined;
vi.mock("../internal/live-again-tracker", () => ({
  startLiveAgainTracking: (_: unknown, hooks: LiveAgainHooks) => {
    liveAgain = hooks;
    return () => {};
  },
}));
const fakeClient = {};
vi.mock(
  "@plugins/network/plugins/live/plugins/live-state/web",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useNotificationsClient: () => fakeClient,
  }),
);
vi.mock("@plugins/config_v2/web", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useConfig: () => ({ pageLoadMs: 5000, liveAgainMs: 10000 }),
}));
let pageHidden = false;
vi.mock(
  "@plugins/primitives/plugins/perfs/plugins/page-pauses/web",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    pausesDuring: () => ({ hiddenMs: pageHidden ? 1 : 0, stalledMs: 0 }),
  }),
);

const recordMock = vi.mocked(recordSample);

const update = () =>
  ({
    signal: "update",
    key: "tasks",
    params: {},
    phases: {
      "watch-delivery": 0,
      "server-notice": 10,
      "throttle-hold": 0,
      "server-deliver": 20,
      transport: 5,
      "page-wait": 0,
      "client-apply": 3,
    },
    totalMs: 38,
  }) as const;

afterEach(() => {
  pageHidden = false;
  order.length = 0;
  vi.mocked(flushOnPageHide).mockClear();
  vi.mocked(cutActiveInteraction).mockClear();
  cleanup();
  recordMock.mockClear();
});

describe("LatencyCollector", () => {
  it("records an update sample's total as update-e2e", () => {
    render(<LatencyCollector />);
    clientLatencySink.emit(update());
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith("update-e2e", 38, {
      excluded: false,
    });
  });

  it("excludes a hidden tab's sample", () => {
    render(<LatencyCollector />);
    pageHidden = true;
    clientLatencySink.emit(update());
    expect(recordMock).toHaveBeenCalledWith("update-e2e", 38, {
      excluded: true,
    });
  });

  it("ignores other signals", () => {
    render(<LatencyCollector />);
    clientLatencySink.emit({
      signal: "confirm",
      key: "page.blocks",
      params: {},
      variant: "exact-ack/push",
      phases: {
        "send-lane": 0,
        retry: 0,
        "request-queue": 0,
        network: 0,
        server: 0,
        "page-resume": 0,
        "ack-unsplit": 40,
        "confirm-frame": 10,
      },
      totalMs: 50,
    });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("on pagehide, cuts the load in flight short BEFORE the final flush", () => {
    // A tab reloading faster than its page settles leaves a row per load only
    // if the unsettled load is recorded before the batch goes out.
    render(<LatencyCollector />);
    window.dispatchEvent(new Event("pagehide"));
    expect(order).toEqual(["cut", "flush"]);
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = render(<LatencyCollector />);
    unmount();
    expect(clientLatencySink.hasSubscribers()).toBe(false);
    window.dispatchEvent(new Event("pagehide"));
    expect(order).toEqual([]);
    clientLatencySink.emit(update());
    expect(recordMock).not.toHaveBeenCalled();
  });
});

describe("a page not ready at its budget", () => {
  it("arms the budget from the slow-op config and files the page-load naming what it waits for", () => {
    const seen: ClientSlowOpSignal[] = [];
    const off = clientSlowOpSink.subscribe((s) => seen.push(s));
    render(<LatencyCollector />);
    expect(readyBudget?.budgetMs()).toBe(5000);
    readyBudget?.onNotReady({
      route: "/agents/c/:convId",
      elapsedMs: 5003.4,
      budgetMs: 5000,
      waitingFor: ["files.computer.stat×4", "x".repeat(500)],
      done: false,
    });
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      operationKind: "page-load",
      operation: "/agents/c/:convId",
      durationMs: 5003,
      thresholdMs: 5000,
      detail: { censored: true },
    });
    expect(seen[0]?.waitingFor?.[0]).toBe("files.computer.stat×4");
    expect(seen[0]?.waitingFor?.[1]).toHaveLength(200);
  });
});

describe("a tab not live again at its budget", () => {
  it("arms the budget from the slow-op config, records the sample, and files live-again naming what it waits for", () => {
    const seen: ClientSlowOpSignal[] = [];
    const off = clientSlowOpSink.subscribe((s) => seen.push(s));
    render(<LatencyCollector />);
    expect(liveAgain?.budgetMs()).toBe(10000);
    liveAgain?.onSample(3100, { censored: false, excluded: false });
    expect(recordMock).toHaveBeenCalledWith("reconnect", 3100, {
      censored: false,
      excluded: false,
    });
    liveAgain?.onNotLive({
      route: "/agents/c/:convId",
      socket: "central",
      elapsedMs: 10001.2,
      budgetMs: 10000,
      waitingFor: ["claude-code-status×4"],
    });
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      operationKind: "live-again",
      operation: "/agents/c/:convId",
      durationMs: 10001,
      thresholdMs: 10000,
      detail: { censored: true },
      waitingFor: ["central: claude-code-status×4"],
    });
  });
});
