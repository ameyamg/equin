import { describe, expect, test } from "bun:test";
import { judgeProcessAwakeAge, readProcessAwakeAge } from "./process-age";

const read = (startedNs: number) =>
  ({
    kind: "read",
    memory: {
      physFootprintBytes: 0,
      residentSizeBytes: 0,
      peakPhysFootprintBytes: 0,
      sharedPages: "whole",
    },
    cpu: { ownNs: 0, reapedChildrenNs: 0 },
    startedNs,
  }) as const;

describe("judgeProcessAwakeAge", () => {
  test("awake age = the awake clock now minus the process's start on it", () => {
    // Started at 1,000 s of awake time; 90 s of awake time later — however
    // long the machine slept in between, which this clock never counts.
    expect(
      judgeProcessAwakeAge(read(1_000_000_000_000), {
        supported: true,
        awakeMs: 1_090_000,
      }),
    ).toEqual({ kind: "awake", awakeMs: 90_000 });
  });

  test("a refused read is refused; no awake clock is unsupported, never young", () => {
    expect(
      judgeProcessAwakeAge(
        { kind: "refused" },
        { supported: true, awakeMs: 1 },
      ),
    ).toEqual({ kind: "refused" });
    expect(judgeProcessAwakeAge(read(0), { supported: false })).toEqual({
      kind: "unsupported",
    });
    expect(
      judgeProcessAwakeAge(
        { kind: "unsupported" },
        { supported: true, awakeMs: 1 },
      ),
    ).toEqual({ kind: "unsupported" });
  });
});

describe.if(process.platform === "darwin")(
  "readProcessAwakeAge (darwin)",
  () => {
    test("this process's awake age tracks performance.now()", async () => {
      const age = await readProcessAwakeAge(process.pid);
      if (age.kind !== "awake")
        throw new Error(`expected a reading, got ${age.kind}`);
      // The kernel's start precedes the JS time origin by the exec + runtime boot.
      expect(age.awakeMs).toBeGreaterThanOrEqual(performance.now() - 5);
      expect(age.awakeMs).toBeLessThan(performance.now() + 5_000);
    });
  },
);
