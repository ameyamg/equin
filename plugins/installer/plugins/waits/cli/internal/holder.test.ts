import { describe, expect, test } from "bun:test";
import {
  foldOpLines,
  toOpRecord,
  type OpEvent,
  type OpRecord,
} from "@plugins/debug/plugins/profiling/plugins/op-log/core";
import {
  HOLDER_QUIET_MS,
  STALL_WAIT_MS,
  holderLastProgress,
  judgeHolder,
  stallWords,
  type BuildRunMoves,
  type CheckRunMoves,
} from "./holder";

const T0 = Date.parse("2026-11-17T12:00:00Z");
const MIN = 60_000;
const iso = (x: number): string => new Date(T0 + x).toISOString();
const OP = "build-1795041710-abcdef";
const PID = 48211;
const SLUG = "main";

/** A machine nap, `atMs` after the op's request, `forMs` long. */
type Sleep = { atMs: number; forMs: number };

/** The machine's sleep clock at `T0 + x`, given the naps before it. */
function sleepAt(x: number, sleeps: readonly Sleep[]) {
  const done = sleeps.filter((sl) => sl.atMs + sl.forMs <= x);
  const last = done.at(-1);
  return {
    boot: "boot-1",
    asleepMs: done.reduce((sum, sl) => sum + sl.forMs, 0),
    wakeAtMs: last === undefined ? null : T0 + last.atMs + last.forMs,
  };
}

/**
 * The holder's op record AS THE INSTALL READS IT: the op-log lines a running
 * build writes (`requested` + `granted` at T0, its own waits, sleep stamps on
 * every line), folded through the one reducer and read at
 * `now`. Never a hand-made record: a fixture with in-flight `steps` — a shape
 * the reader never produces — is how the bug this rule had stayed hidden.
 */
function holder(
  now: number,
  {
    sleeps = [],
    outcome = "running",
    parkedAt,
    waited,
  }: {
    sleeps?: Sleep[];
    outcome?: "running" | "success";
    /** A wait of its own opened then, still open. */
    parkedAt?: number;
    /** A wait of its own over [from, to]. */
    waited?: [number, number];
  } = {},
): OpRecord {
  let seq = 0;
  const line = (x: number, body: object): OpEvent => {
    const { wakeAtMs, ...stamp } = sleepAt(x, sleeps);
    return {
      v: 2,
      opId: OP,
      seq: ++seq,
      at: iso(x),
      t: x,
      sleep: wakeAtMs === null ? stamp : { ...stamp, wakeAtMs },
      ...body,
    } as OpEvent;
  };
  const identity = {
    kind: "build",
    opSlug: SLUG,
    branch: "main",
    conversationId: null,
    lane: "interactive",
    mode: null,
    buildId: OP,
    pid: PID,
  };
  const lines: OpEvent[] = [
    line(0, { e: "requested", ...identity }),
    line(0, { e: "granted" }),
  ];
  if (waited !== undefined)
    lines.push(
      line(waited[0], {
        e: "wait-start",
        wait: "host-grant",
        reason: null,
        cycle: 0,
      }),
      line(waited[1], {
        e: "wait-end",
        wait: "host-grant",
        startMs: waited[0],
        durationMs: waited[1] - waited[0],
        result: "acquired",
        reason: null,
        cycle: 0,
      }),
    );
  if (parkedAt !== undefined)
    lines.push(
      line(parkedAt, {
        e: "wait-start",
        wait: "host-grant",
        reason: null,
        cycle: 0,
      }),
    );
  if (outcome === "success")
    lines.push(
      line(MIN, {
        e: "completed",
        by: "self",
        summary: {
          ...identity,
          requestedAt: iso(0),
          grantedAt: iso(0),
          completedAt: iso(MIN),
          waits: [],
          holdMs: MIN,
          totalMs: MIN,
          outcome: "success",
          interrupted: false,
          steps: [],
        },
      }),
    );
  const state = foldOpLines(lines).get(OP);
  if (state === undefined) throw new Error("the fold lost the op");
  const record = toOpRecord(state, now, sleepAt(now - T0, sleeps));
  if (record === null) throw new Error("the fold rendered no record");
  return record;
}

/** The holder's build run (build-progress), last moved `x` ms after T0. */
const buildRun = (x: number, over: Partial<BuildRunMoves> = {}) => ({
  pid: PID,
  lastAdvanceAt: iso(x),
  ...over,
});

/**
 * A check run (check-progress) settling a check at each of `ats`: by default
 * the holder build's check-pass child — another pid, the build's op id as its
 * run id.
 */
const checkRun = (ats: number[], over: Partial<CheckRunMoves> = {}) => ({
  runId: OP,
  pid: PID + 1,
  startedAt: iso(ats[0] ?? 0),
  completed: ats.map((x) => ({ at: iso(x) })),
  ...over,
});

/** The stall verdict on the holder at `now`, from what its logs say. */
function verdict(
  record: OpRecord,
  waitedMs: number,
  now: number,
  builds: BuildRunMoves[] = [],
  checks: CheckRunMoves[] = [],
) {
  return judgeHolder(
    record,
    holderLastProgress(record, builds, checks),
    waitedMs,
    now,
  );
}

describe("the install's stall rule (the build slot's holder stopped making progress)", () => {
  test("a healthy build that keeps moving past 10 minutes of holding the slot is never stalled", () => {
    // The 2026-11 report: a cold deploy on an 8 GB machine holds the slot
    // 13–17 minutes, and was called stalled at 10 because its in-flight record
    // has no steps. Its spans moved 1 minute before the look, at 17 min.
    const now = T0 + 17 * MIN;
    expect(verdict(holder(now), 15 * MIN, now, [buildRun(16 * MIN)])).toEqual({
      stuck: false,
      recheckInMs: HOLDER_QUIET_MS - MIN,
    });
  });

  test("a build inside a long check pass is moving while its checks settle", () => {
    // The build's own spans last moved at 2 min (it entered the check pass);
    // its check-pass child, run under the build's op id, settled a check at 15.
    const now = T0 + 17 * MIN;
    expect(
      verdict(
        holder(now),
        15 * MIN,
        now,
        [buildRun(2 * MIN)],
        [checkRun([3 * MIN, 9 * MIN, 15 * MIN])],
      ),
    ).toEqual({ stuck: false, recheckInMs: HOLDER_QUIET_MS - 2 * MIN });
  });

  test("a build that really stops is stalled after the same 10 quiet minutes", () => {
    const builds = [buildRun(6 * MIN)];
    const at = (m: number) =>
      verdict(holder(T0 + m * MIN), 12 * MIN, T0 + m * MIN, builds);
    expect(at(15)).toEqual({ stuck: false, recheckInMs: MIN });
    expect(at(16)).toEqual({ stuck: true, quietSince: T0 + 6 * MIN });
  });

  test("not before the install has waited STALL_WAIT_MS awake, even on a long-quiet holder", () => {
    const now = T0 + 3 * 60 * MIN;
    const builds = [buildRun(9 * MIN)];
    expect(verdict(holder(now), MIN, now, builds)).toEqual({
      stuck: false,
      recheckInMs: STALL_WAIT_MS - MIN,
    });
    expect(verdict(holder(now), STALL_WAIT_MS, now, builds)).toEqual({
      stuck: true,
      quietSince: T0 + 9 * MIN,
    });
  });

  test("a holder no progress log names is judged from when it got the slot", () => {
    const now = T0 + 11 * MIN;
    expect(verdict(holder(now), STALL_WAIT_MS, now)).toEqual({
      stuck: true,
      quietSince: T0,
    });
  });

  test("another process's run, another op's check run or a dead pid's old run never counts as the holder's progress", () => {
    const now = T0 + 11 * MIN;
    expect(
      verdict(
        holder(now),
        STALL_WAIT_MS,
        now,
        [
          buildRun(10 * MIN, { pid: PID + 7 }),
          // A process that had this pid before, and died before this op began.
          buildRun(-5 * MIN),
        ],
        [checkRun([10 * MIN], { runId: "someone-else" })],
      ),
    ).toEqual({ stuck: true, quietSince: T0 });
  });

  test("a check run in the holder's own process counts, whatever it is named", () => {
    // `./equin check` holding the slot: its run id is its own, its pid the op's.
    const now = T0 + 11 * MIN;
    expect(
      verdict(
        holder(now),
        STALL_WAIT_MS,
        now,
        [],
        [checkRun([4 * MIN, 9 * MIN], { runId: "check-run-1", pid: PID })],
      ),
    ).toEqual({ stuck: false, recheckInMs: HOLDER_QUIET_MS - 2 * MIN });
  });

  test("back from a wait of its own, the holder is judged from when the wait ended", () => {
    // Moved at 4, queued 5–30 for its own grant, judged at 38: 8 quiet minutes.
    const now = T0 + 38 * MIN;
    expect(
      verdict(holder(now, { waited: [5 * MIN, 30 * MIN] }), 30 * MIN, now, [
        buildRun(4 * MIN),
      ]),
    ).toEqual({ stuck: false, recheckInMs: HOLDER_QUIET_MS - 8 * MIN });
  });

  test("a holder parked in a wait of its own is queued, not stuck", () => {
    const now = T0 + 30 * MIN;
    expect(verdict(holder(now, { parkedAt: 5 * MIN }), 20 * MIN, now)).toEqual({
      stuck: false,
      recheckInMs: HOLDER_QUIET_MS,
    });
  });

  test("a machine sleep is not quiet: a holder quiet 2 h on the wall, all but 3 min of it asleep, is not stuck", () => {
    // Moved at 10 min, the Mac slept from 11 min to 2 h 10 min, judged 2 min
    // after the wake (3 awake minutes quiet) — not 2 h.
    const sleeps = [{ atMs: 11 * MIN, forMs: 119 * MIN }];
    const now = T0 + 132 * MIN;
    expect(
      verdict(holder(now, { sleeps }), STALL_WAIT_MS, now, [
        buildRun(10 * MIN),
      ]),
    ).toEqual({ stuck: false, recheckInMs: HOLDER_QUIET_MS - 3 * MIN });
  });

  test("a holder that makes no progress while the machine is awake is still stuck, sleeps or not", () => {
    // Same nap, judged 12 awake minutes after the last move (1 before the nap,
    // 11 after the wake).
    const sleeps = [{ atMs: 11 * MIN, forMs: 119 * MIN }];
    const now = T0 + 141 * MIN;
    expect(
      verdict(holder(now, { sleeps }), STALL_WAIT_MS, now, [
        buildRun(10 * MIN),
      ]),
    ).toEqual({ stuck: true, quietSince: T0 + 10 * MIN });
    // No sleep the op log could tell: the wall span, never in the holder's favour.
    expect(
      verdict(holder(T0 + 20 * MIN), STALL_WAIT_MS, T0 + 20 * MIN, [
        buildRun(10 * MIN),
      ]),
    ).toEqual({ stuck: true, quietSince: T0 + 10 * MIN });
  });

  test("a sleep before the last progress does not count toward the quiet span", () => {
    const sleeps = [{ atMs: 2 * MIN, forMs: 60 * MIN }];
    const now = T0 + 75 * MIN;
    expect(
      verdict(holder(now, { sleeps }), STALL_WAIT_MS, now, [
        buildRun(70 * MIN),
      ]),
    ).toEqual({ stuck: false, recheckInMs: HOLDER_QUIET_MS - 5 * MIN });
  });

  test("a holder that finished is never a stall", () => {
    const now = T0 + 60 * MIN;
    expect(verdict(holder(now, { outcome: "success" }), 60 * MIN, now)).toEqual(
      { stuck: false, recheckInMs: null },
    );
  });

  test("its words: no internal names in the message, the op in the evidence, one event's size", () => {
    const words = stallWords(
      holder(T0 + 3 * 60 * MIN),
      T0 + 9 * MIN,
      T0 + 3 * 60 * MIN,
    );
    expect(words.text).toContain("A build started 3 hours ago");
    expect(words.text).not.toMatch(/op-|grant|pid/);
    expect(words.evidence[0]).toContain(OP);
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
