import { describe, expect, it } from "bun:test";
import {
  canPan,
  fitAxisScale,
  initialZoom,
  isAtFit,
  visibleBox,
  zoomReducer,
  type ZoomAction,
  type ZoomState,
} from "./zoom-model";

const TALL = { width: 1400, height: 4000 };
const PANE = { width: 700, height: 800 };

function run(state: ZoomState, ...actions: ZoomAction[]): ZoomState {
  return actions.reduce(zoomReducer, state);
}

const whole = run(initialZoom(TALL), { type: "measure", viewport: PANE });
const measured = run(whole, { type: "fit", fit: "width" });

describe("zoom model", () => {
  it("starts with the whole picture, centred", () => {
    expect(whole.view.scale).toBeCloseTo(0.2);
    expect(whole.fit).toBe("whole");
    expect(isAtFit(whole, "whole")).toBe(true);
    expect(canPan(whole)).toBe(false);
    expect(visibleBox(whole)).toEqual({
      left: 210,
      top: 0,
      width: 280,
      height: 800,
    });
  });

  it("fit width reads a tall picture from its top", () => {
    expect(measured.view).toEqual({ scale: 0.5, x: 0, y: 0 });
    expect(isAtFit(measured, "width")).toBe(true);
    expect(canPan(measured)).toBe(true);
    expect(visibleBox(measured)).toEqual({
      left: 0,
      top: 0,
      width: 700,
      height: 800,
    });
  });

  it("fit height shows the whole tall picture, centred, framed to it", () => {
    const s = run(measured, { type: "fit", fit: "height" });
    expect(s.view.scale).toBeCloseTo(0.2);
    expect(canPan(s)).toBe(false);
    expect(visibleBox(s)).toEqual({
      left: 210,
      top: 0,
      width: 280,
      height: 800,
    });
    expect(isAtFit(s, "whole")).toBe(true);
  });

  it("never zooms out past the whole picture", () => {
    const s = run(measured, { type: "zoom-by", factor: 0.01, x: 0, y: 0 });
    expect(s.view.scale).toBeCloseTo(0.2);
    expect(s.fit).toBeNull();
  });

  it("1:1 is the real size, around the centre", () => {
    const s = run(measured, { type: "actual-size" });
    expect(s.view.scale).toBe(1);
  });

  it("pans within the picture only", () => {
    const s = run(measured, {
      type: "pan",
      from: measured.view,
      dx: 0,
      dy: -100_000,
    });
    expect(s.view.y).toBe(PANE.height - TALL.height * 0.5);
    expect(s.view.x).toBe(0);
  });

  it("a resize re-applies the fit, keeping the reader's place", () => {
    const scrolled = {
      ...measured,
      view: { ...measured.view, y: -400 },
    };
    const s = run(scrolled, {
      type: "measure",
      viewport: { width: 1400, height: 800 },
    });
    expect(s.view).toEqual({ scale: 1, x: 0, y: -800 });
  });

  it("whole fits the axis that runs out of room first", () => {
    expect(fitAxisScale("whole", { width: 4000, height: 1000 }, PANE)).toBe(
      700 / 4000,
    );
  });

  it("fit width may enlarge a small picture", () => {
    expect(
      fitAxisScale("width", { width: 200, height: 100 }, PANE),
    ).toBeCloseTo(3.5);
  });
});
