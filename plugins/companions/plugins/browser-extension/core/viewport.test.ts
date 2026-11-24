import { describe, expect, test } from "bun:test";
import {
  outputFor,
  presetFit,
  recordPreset,
  windowBoundsFor,
  type TabMeasure,
} from "./viewport";

/** A 14" MacBook (1512 × 982 pt, menu bar 37), a window with 87 pt of chrome. */
function measure(over: Partial<TabMeasure> = {}): TabMeasure {
  return {
    window: { left: 100, top: 60, width: 1400, height: 900 },
    windowState: "normal",
    innerWidth: 1400,
    innerHeight: 813,
    devicePixelRatio: 2,
    zoom: 1,
    workArea: { left: 0, top: 37, width: 1512, height: 945 },
    ...over,
  };
}

describe("windowBoundsFor", () => {
  test("adds the measured chrome to the page size", () => {
    expect(windowBoundsFor({ width: 1280, height: 720 }, measure())).toEqual({
      ok: true,
      value: { left: 100, top: 60, width: 1280, height: 807 },
    });
  });

  test("moves the window back onto its display", () => {
    const m = measure({
      window: { left: 900, top: 300, width: 1400, height: 900 },
    });
    expect(windowBoundsFor({ width: 1280, height: 720 }, m)).toEqual({
      ok: true,
      value: { left: 232, top: 175, width: 1280, height: 807 },
    });
  });

  test("9:16 does not fit a 14-inch screen", () => {
    expect(windowBoundsFor({ width: 540, height: 960 }, measure())).toEqual({
      ok: false,
      reason: "does-not-fit",
    });
    expect(presetFit(recordPreset("vertical"), measure())).toEqual({
      ok: false,
      reason: "does-not-fit",
    });
  });

  test("a zoomed tab is refused", () => {
    expect(
      windowBoundsFor({ width: 1280, height: 720 }, measure({ zoom: 1.25 })),
    ).toEqual({ ok: false, reason: "zoomed" });
  });
});

describe("outputFor", () => {
  test("a preset's own size on Retina", () => {
    expect(outputFor(recordPreset("1440p"), measure())).toEqual({
      ok: true,
      value: { width: 2560, height: 1440 },
    });
  });

  test("refuses an upscale on a DPR-1 display", () => {
    const m = measure({ devicePixelRatio: 1 });
    expect(outputFor(recordPreset("720p"), m).ok).toBe(true);
    expect(outputFor(recordPreset("1080p"), m)).toEqual({
      ok: false,
      reason: "upscale",
    });
  });

  test("As is: the page's physical size, made even", () => {
    const m = measure({
      innerWidth: 1001.5,
      innerHeight: 701,
      devicePixelRatio: 1,
    });
    expect(outputFor(recordPreset("as-is"), m)).toEqual({
      ok: true,
      value: { width: 1000, height: 700 },
    });
  });
});
