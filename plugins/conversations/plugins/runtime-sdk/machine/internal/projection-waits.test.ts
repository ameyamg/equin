import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  type AgentProjection,
  EMPTY_PROJECTION,
} from "../../server/internal/reducer";
import {
  createProjectionWaits,
  ProjectionTimeoutError,
} from "./projection-waits";
import { startOutcome } from "./start-outcome";

// report-1795351229-ikx53i: the launch's 60 s wait began, the agent wrote
// `started` (seq 27458), and 220 ms later the Mac slept for 937.7 s. On wake
// the timer fired at once and the launch reported the consumer stalled.
const ID = "conv-1-test";
const BUDGET_MS = 60_000;
const SLEPT_MS = 937_692;
const AGENT_SEQ = 27_458;

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

/** A launch's wait for `started`, judged as `waitForStart` judges it. */
function launchWait() {
  // Timers count sleep; the awake clock moves only in `awake`.
  let awakeMs = 0;
  let row: AgentProjection = { ...EMPTY_PROJECTION, cursorSeq: AGENT_SEQ - 1 };
  const waits = createProjectionWaits({
    current: () => Promise.resolve(row),
    catchUp: () => {},
    clock: () => awakeMs,
  });
  let ended = false;
  const outcome = waits
    .wait(ID, (s) => s.agentPid !== null, BUDGET_MS, "the agent's start")
    .then(
      () => true,
      (err: unknown) => {
        if (err instanceof ProjectionTimeoutError) return false;
        throw err;
      },
    )
    .then((applied) => {
      ended = true;
      return startOutcome({
        applied,
        agentSeq: AGENT_SEQ,
        cursorSeq: row.cursorSeq,
      });
    });

  async function settle() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }
  return {
    outcome,
    async ended() {
      await settle();
      return ended;
    },
    async awake(ms: number) {
      await settle();
      awakeMs += ms;
      jest.advanceTimersByTime(ms);
    },
    async sleep(ms: number) {
      await settle();
      jest.advanceTimersByTime(ms);
    },
    applyStarted() {
      row = { ...row, cursorSeq: AGENT_SEQ, agentPid: 4242 };
      waits.applied(ID, row);
    },
  };
}

describe("a launch's wait for the consumer", () => {
  test("started just before a sleep, applied on wake: not stalled", async () => {
    const launch = launchWait();
    await launch.awake(700);
    await launch.sleep(SLEPT_MS);
    await launch.awake(330); // when the false report was filed
    expect(await launch.ended()).toBe(false);
    launch.applyStarted();
    expect(await launch.outcome).toEqual({ kind: "ready" });
  });

  test("never applied while awake: stalled at the bound", async () => {
    const launch = launchWait();
    await launch.awake(BUDGET_MS - 1);
    expect(await launch.ended()).toBe(false);
    await launch.awake(1);
    expect(await launch.outcome).toEqual({
      kind: "consumer-behind",
      cursorSeq: AGENT_SEQ - 1,
      agentSeq: AGENT_SEQ,
    });
  });

  test("stalled across a sleep: still reported, after the bound's awake time", async () => {
    const launch = launchWait();
    await launch.awake(700);
    await launch.sleep(SLEPT_MS);
    await launch.awake(BUDGET_MS - 701);
    expect(await launch.ended()).toBe(false);
    await launch.awake(1);
    expect(await launch.outcome).toEqual({
      kind: "consumer-behind",
      cursorSeq: AGENT_SEQ - 1,
      agentSeq: AGENT_SEQ,
    });
  });
});
