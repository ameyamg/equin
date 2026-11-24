import { describe, expect, test } from "bun:test";
import { PER_UNIT_BYTES } from "@plugins/infra/plugins/host/plugins/host-admission/core";
import {
  peaksOfScript,
  SCRIPT_PEAK_WINDOW_MS,
  scriptWeight,
} from "./script-weight";

const Q = PER_UNIT_BYTES;

describe("scriptWeight", () => {
  test("a script with no record, or only light runs, is light", () => {
    expect(scriptWeight([], 6)).toEqual({ kind: "light" });
    expect(scriptWeight([0.2 * Q, 0.9 * Q], 6)).toEqual({ kind: "light" });
  });

  test("one recent run of a quantum or more makes it heavy, sized in quanta", () => {
    expect(scriptWeight([0.1 * Q, 2.4 * Q, 0.1 * Q], 6)).toEqual({
      kind: "heavy",
      peakBytes: 2.4 * Q,
      units: 3,
      reserveBytes: 2.4 * Q,
    });
    expect(scriptWeight([Q], 6)).toEqual({
      kind: "heavy",
      peakBytes: Q,
      units: 1,
      reserveBytes: Q,
    });
  });

  test("a script heavier than the lane takes the whole lane", () => {
    expect(scriptWeight([9 * Q], 6)).toMatchObject({
      units: 6,
      reserveBytes: 6 * Q,
    });
    expect(scriptWeight([9 * Q], 1)).toMatchObject({ units: 1 });
  });

  test("five light runs after a heavy one make it light again", () => {
    const light = [0.1, 0.1, 0.1, 0.1, 0.1].map((x) => x * Q);
    expect(scriptWeight([3 * Q, ...light.slice(1)], 6).kind).toBe("heavy");
    expect(scriptWeight([3 * Q, ...light], 6)).toEqual({ kind: "light" });
  });
});

describe("peaksOfScript", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  const rec = (script: string, agoMs: number, peakBytes: number) => ({
    t: new Date(now - agoMs).toISOString(),
    script,
    peakBytes,
  });

  test("keeps this script's runs inside the window, oldest first", () => {
    const records = [
      rec("a.ts", 1_000, 3),
      rec("b.ts", 2_000, 9),
      rec("a.ts", 5_000, 1),
      rec("a.ts", SCRIPT_PEAK_WINDOW_MS + 1_000, 7),
    ];
    expect(peaksOfScript(records, "a.ts", now)).toEqual([1, 3]);
  });
});
