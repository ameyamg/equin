import { describe, expect, test } from "bun:test";
import type { OpRecord } from "@plugins/debug/plugins/profiling/plugins/op-log/core";
import {
  HOLDER_QUIET_MS,
  STALL_WAIT_MS,
  judgeHolder,
  stallWords,
} from "./holder";

const T0 = Date.parse("2026-11-17T12:00:00Z");
const MIN = 60_000;

/** A sleep inside the op's span, `atMs` after its request, `forMs` long. */
type Sleep = { atMs: number; forMs: number };

/**
 * A running op that got the build slot at T0 and last made progress `quietAt`
 * ms after; `sleeps` are the machine's naps the op log placed on its span.
 */
function holder(
  quietAt: number,
  outcome = "running",
  sleeps: Sleep[] = [],
): OpRecord {
  return {
    opId: "op-48211",
    kind: "test",
    pid: 48211,
    requestedAt: new Date(T0).toISOString(),
    grantedAt: new Date(T0).toISOString(),
    steps: [{ name: "run", startMs: 0, durationMs: quietAt }],
    outcome,
    sleeps: sleeps.map((s) => ({
      startMs: s.atMs,
      durationMs: s.forMs,
      approx: false,
    })),
  } as unknown as OpRecord;
}

describe("the install's stall rule (the build slot's holder stopped making progress)", () => {
  test("not before the install has waited STALL_WAIT_MS awake, even on a long-quiet holder", () => {
    const now = T0 + 3 * 60 * MIN;
    expect(judgeHolder(holder(9 * MIN), MIN, now)).toEqual({
      stuck: false,
      recheckInMs: STALL_WAIT_MS - MIN,
    });
    expect(judgeHolder(holder(9 * MIN), STALL_WAIT_MS, now)).toEqual({
      stuck: true,
      quietSince: T0 + 9 * MIN,
    });
  });

  test("a holder still moving is not stuck: the next look is when it would have been quiet long enough", () => {
    // Last progress 3 minutes before now.
    const verdict = judgeHolder(holder(19 * MIN), STALL_WAIT_MS, T0 + 22 * MIN);
    expect(verdict).toEqual({
      stuck: false,
      recheckInMs: HOLDER_QUIET_MS - 3 * MIN,
    });
  });

  test("a machine sleep is not quiet: a holder quiet 2 h on the wall, all but 3 min of it asleep, is not stuck", () => {
    // Progress at 10 min, the Mac slept from 11 min to 2 h 10 min, judged
    // 3 min after the wake — the first look on wake must not read 2 h quiet.
    const sleeps = [{ atMs: 11 * MIN, forMs: 119 * MIN }];
    const verdict = judgeHolder(
      holder(10 * MIN, "running", sleeps),
      STALL_WAIT_MS,
      T0 + 132 * MIN,
    );
    expect(verdict).toEqual({
      stuck: false,
      recheckInMs: HOLDER_QUIET_MS - 3 * MIN,
    });
  });

  test("a holder that makes no progress while the machine is awake is still stuck, sleeps or not", () => {
    // Same nap, but judged 12 awake minutes after the last progress (1 before
    // the nap, 11 after the wake).
    const sleeps = [{ atMs: 11 * MIN, forMs: 119 * MIN }];
    expect(
      judgeHolder(
        holder(10 * MIN, "running", sleeps),
        STALL_WAIT_MS,
        T0 + 141 * MIN,
      ),
    ).toEqual({ stuck: true, quietSince: T0 + 10 * MIN });
    // No sleep the op log could tell: the wall span, never in the holder's favour.
    expect(judgeHolder(holder(10 * MIN), STALL_WAIT_MS, T0 + 20 * MIN)).toEqual(
      { stuck: true, quietSince: T0 + 10 * MIN },
    );
  });

  test("a sleep before the last progress does not count toward the quiet span", () => {
    const sleeps = [{ atMs: 2 * MIN, forMs: 60 * MIN }];
    expect(
      judgeHolder(
        holder(70 * MIN, "running", sleeps),
        STALL_WAIT_MS,
        T0 + 75 * MIN,
      ),
    ).toEqual({ stuck: false, recheckInMs: HOLDER_QUIET_MS - 5 * MIN });
  });

  test("a holder that finished is never a stall", () => {
    expect(judgeHolder(holder(0, "success"), 60 * MIN, T0 + 60 * MIN)).toEqual({
      stuck: false,
      recheckInMs: null,
    });
    expect(judgeHolder(undefined, 60 * MIN, T0 + 60 * MIN)).toEqual({
      stuck: false,
      recheckInMs: null,
    });
  });

  test("its words: no internal names in the message, the op in the evidence, one event's size", () => {
    const words = stallWords(holder(9 * MIN), T0 + 9 * MIN, T0 + 3 * 60 * MIN);
    expect(words.text).toContain("A test started 3 hours ago");
    expect(words.text).not.toMatch(/op-|grant|pid/);
    expect(words.evidence[0]).toContain("op-48211");
    expect(
      Buffer.byteLength(
        JSON.stringify({
          v: 1,
          t: "2026-11-17T12:00:00Z",
          type: "pause",
          step: "build.interface",
          kind: "stall",
          ...words,
          blocking: false,
          optional: false,
          manual: null,
        }),
      ),
    ).toBeLessThan(512);
  });
});
