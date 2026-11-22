import { describe, expect, test } from "bun:test";
import type { SleepStamp } from "@plugins/packages/plugins/sleep-clock/plugins/stamp/core";
import { createCatchUpLedger } from "./catch-up-owed";

const REPO = "equinai/equin";

/** A ledger over fakes: each catch-up runs the next scripted step. */
function harness(opts: { clock?: "readable" | "unreadable" } = {}) {
  let asleepMs = 0;
  const steps: (() => Promise<void>)[] = [];
  const calls: string[] = [];
  const reports: { repo: string; message: string }[] = [];
  const logs: string[] = [];
  const ledger = createCatchUpLedger({
    catchUp: (repo) => {
      calls.push(repo);
      const step = steps.shift();
      return step === undefined ? Promise.resolve() : step();
    },
    sleepStamp: (): SleepStamp | null =>
      opts.clock === "unreadable" ? null : { boot: "b1", asleepMs },
    report: (repo, err) =>
      reports.push({ repo, message: (err as Error).message }),
    log: (line) => logs.push(line),
  });
  return {
    ledger,
    calls,
    reports,
    logs,
    /** The next catch-up fails; with `sleepMs`, the machine sleeps through it first. */
    failNext(message: string, sleepMs = 0) {
      steps.push(() => {
        asleepMs += sleepMs;
        return Promise.reject(new Error(message));
      });
    },
    succeedNext() {
      steps.push(() => Promise.resolve());
    },
    /** The next catch-up waits on `gate` (a reconnect lands mid-attempt). */
    holdNext(gate: Promise<void>) {
      steps.push(() => gate);
    },
  };
}

const RESET =
  "read tcp 192.168.1.8:61039->20.250.119.72:443: read: connection reset by peer";

describe("catch-up ledger", () => {
  test("a ping runs the catch-up; success pays it off", async () => {
    const h = harness();
    h.ledger.owe(REPO);
    await h.ledger.idle(REPO);
    expect(h.calls).toEqual([REPO]);
    expect(h.ledger.owed()).toEqual([]);
    expect(h.reports).toEqual([]);
  });

  test("an attempt a sleep cut off is run again at once, logged, not reported", async () => {
    const h = harness();
    h.failNext(RESET, 993_632);
    h.succeedNext();
    h.ledger.owe(REPO);
    await h.ledger.idle(REPO);
    expect(h.calls).toEqual([REPO, REPO]);
    expect(h.reports).toEqual([]);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toContain("cut by a 994 s machine sleep");
    expect(h.ledger.owed()).toEqual([]);
  });

  test("a failure an awake machine met is reported, and stays owed until a wake retries it", async () => {
    const h = harness();
    h.failNext(RESET);
    h.ledger.owe(REPO);
    await h.ledger.idle(REPO);
    expect(h.reports).toEqual([{ repo: REPO, message: RESET }]);
    expect(h.ledger.owed()).toEqual([REPO]);

    h.succeedNext();
    h.ledger.retryOwed();
    await h.ledger.idle(REPO);
    expect(h.calls).toEqual([REPO, REPO]);
    expect(h.ledger.owed()).toEqual([]);
  });

  test("a failure that persists is reported at every attempt", async () => {
    const h = harness();
    h.failNext("HTTP 502");
    h.failNext("HTTP 502");
    h.ledger.owe(REPO);
    await h.ledger.idle(REPO);
    h.ledger.retryOwed();
    await h.ledger.idle(REPO);
    expect(h.reports.map((r) => r.message)).toEqual(["HTTP 502", "HTTP 502"]);
    expect(h.ledger.owed()).toEqual([REPO]);
  });

  test("a sleep-cut retry that then fails awake is reported", async () => {
    const h = harness();
    h.failNext(RESET, 600_000);
    h.failNext("could not resolve host api.github.com");
    h.ledger.owe(REPO);
    await h.ledger.idle(REPO);
    expect(h.calls).toEqual([REPO, REPO]);
    expect(h.reports.map((r) => r.message)).toEqual([
      "could not resolve host api.github.com",
    ]);
    expect(h.ledger.owed()).toEqual([REPO]);
  });

  test("where the sleep clock cannot be read, a failure is reported", async () => {
    const h = harness({ clock: "unreadable" });
    h.failNext(RESET);
    h.ledger.owe(REPO);
    await h.ledger.idle(REPO);
    expect(h.reports).toHaveLength(1);
    expect(h.calls).toEqual([REPO]);
  });

  test("a wake with nothing owed runs nothing", async () => {
    const h = harness();
    h.ledger.retryOwed();
    h.ledger.owe(REPO);
    await h.ledger.idle(REPO);
    h.ledger.retryOwed();
    await h.ledger.idle(REPO);
    expect(h.calls).toEqual([REPO]);
  });

  test("a reconnect during an attempt owes one more attempt after it", async () => {
    const h = harness();
    let open!: () => void;
    h.holdNext(new Promise<void>((r) => (open = r)));
    h.ledger.owe(REPO);
    h.ledger.owe(REPO); // the forwarder reconnected while the first ran
    open();
    await h.ledger.idle(REPO);
    expect(h.calls).toEqual([REPO, REPO]);
    expect(h.ledger.owed()).toEqual([]);
  });

  test("forgotten (forwarders stopped) mid-attempt: its failure is neither reported nor retried", async () => {
    const h = harness();
    let fail!: (err: Error) => void;
    h.holdNext(new Promise<void>((_, reject) => (fail = reject)));
    h.ledger.owe(REPO);
    h.ledger.forgetAll();
    fail(new Error("no forwarder runs"));
    await h.ledger.idle(REPO);
    expect(h.reports).toEqual([]);
    expect(h.calls).toEqual([REPO]);
    h.ledger.retryOwed();
    await h.ledger.idle(REPO);
    expect(h.calls).toEqual([REPO]);
  });
});
