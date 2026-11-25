/**
 * `SpawnResult.ended`: a failure message says how its child ended — on its
 * own, by this call's deadline, or by a signal from outside — instead of the
 * `exit 143` that read both kills the same (task-1795610805-sg6lfe).
 */
import { describe, expect, test } from "bun:test";
import { spawnCaptured, spawnExpectOk, SpawnFailedError } from "./index";
import { describeSpawnEnd } from "./internal/spawn-end";

const BOUND = { timeoutMs: 10_000 };

describe("describeSpawnEnd", () => {
  const base = {
    exitCode: 0,
    signalCode: null,
    timedOut: false,
    timeoutMs: 60_000,
    ranMs: 120,
    cpuTimeMicros: 80_000,
  };

  test("a child that exited on its own is its exit code", () => {
    expect(describeSpawnEnd({ ...base, exitCode: 1 })).toBe("exit 1");
  });

  test("our deadline names itself, the awake time and the CPU spent", () => {
    expect(
      describeSpawnEnd({
        ...base,
        exitCode: 143,
        signalCode: "SIGTERM",
        timedOut: true,
        ranMs: 60_012,
        cpuTimeMicros: 123_000,
      }),
    ).toBe(
      "killed by SIGTERM from this call's own 60 s deadline, after 60.0 s awake and 0.12 s of CPU",
    );
  });

  test("a signal that was not our deadline is said to come from outside", () => {
    expect(
      describeSpawnEnd({ ...base, exitCode: 143, signalCode: "SIGTERM" }),
    ).toContain("killed by SIGTERM, sent from outside this call");
  });
});

describe("spawnCaptured's ended", () => {
  test("a real timeout", async () => {
    const r = await spawnCaptured(["sleep", "30"], { timeoutMs: 100 });
    expect(r.ended).toMatch(
      /^killed by SIGTERM from this call's own 0 s deadline, after 0\.\d s awake/,
    );
    expect(r.ranMs).toBeGreaterThanOrEqual(90);
  }, 15_000);

  test("a signal from outside", async () => {
    const r = await spawnCaptured(["sh", "-c", "kill -TERM $$"], BOUND);
    expect(r.ended).toStartWith("killed by SIGTERM, sent from outside");
  });

  test("SpawnFailedError carries it", async () => {
    const err = await spawnExpectOk(["sh", "-c", "exit 3"], BOUND).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SpawnFailedError);
    expect((err as Error).message).toStartWith(
      "Command failed (exit 3): sh -c",
    );
  });
});
