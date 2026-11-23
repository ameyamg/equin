import { describe, expect, test } from "bun:test";
import { isOrphanedTemp, isProcessAlive, writerPidOf } from "./process-alive";

const TMP = /\.tmp\.(\d+)$/;

/** A pid that was a process a moment ago and is not any more. */
function deadPid(): number {
  return Bun.spawnSync(["true"]).pid;
}

describe("isProcessAlive", () => {
  test("this process is alive", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("an exited child is dead", () => {
    expect(isProcessAlive(deadPid())).toBe(false);
  });

  test("pid 1 (another account's) counts as alive", () => {
    expect(isProcessAlive(1)).toBe(true);
  });

  test("a non-pid throws", () => {
    expect(() => isProcessAlive(0)).toThrow();
    expect(() => isProcessAlive(-3)).toThrow();
  });
});

describe("pid-tagged temps", () => {
  test("the pattern's capture is the writer pid", () => {
    expect(writerPidOf("x.json.tmp.4242", TMP)).toBe(4242);
    expect(writerPidOf("x.json", TMP)).toBeNull();
  });

  test("a live writer's temp is kept, a dead writer's and an untagged one go", () => {
    expect(isOrphanedTemp(`a.tmp.${process.pid}`, TMP)).toBe(false);
    expect(isOrphanedTemp(`a.tmp.${deadPid()}`, TMP)).toBe(true);
    expect(isOrphanedTemp("a.tmp", TMP)).toBe(true);
  });
});
