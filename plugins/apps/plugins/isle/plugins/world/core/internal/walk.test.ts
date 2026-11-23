import { describe, expect, test } from "bun:test";
import type { Pt } from "./geometry";
import { routeAround, type Solid } from "./walk";

const clear = (route: readonly Pt[], [x, y, r]: Solid, margin: number) =>
  route.every((p) => Math.hypot(p[0] - x, p[1] - y) >= r + margin - 1e-6);

/** The largest step between consecutive points: no jump across the solid. */
const maxStep = (route: readonly Pt[]) =>
  Math.max(
    ...route
      .slice(1)
      .map((p, i) => Math.hypot(p[0] - route[i]![0], p[1] - route[i]![1])),
  );

describe("routeAround", () => {
  const fire: Solid = [0, 0, 22];

  test("a route straight through a solid goes round it, without a jump", () => {
    const route = routeAround(
      [
        [-100, 0],
        [100, 0],
      ],
      [fire],
      10,
    );
    expect(clear(route, fire, 10)).toBe(true);
    expect(maxStep(route)).toBeLessThan(10);
    expect(route[0]).toEqual([-100, 0]);
    expect(route.at(-1)).toEqual([100, 0]);
  });

  test("a route grazing a solid bends round the side it leaned to", () => {
    const route = routeAround(
      [
        [-100, 12],
        [100, 12],
      ],
      [fire],
      10,
    );
    expect(clear(route, fire, 10)).toBe(true);
    expect(route.every((p) => p[1] >= 0)).toBe(true);
  });

  test("a route starting inside a solid starts at its edge", () => {
    const route = routeAround(
      [
        [0, 0],
        [100, 0],
      ],
      [fire],
      10,
    );
    expect(clear(route, fire, 10)).toBe(true);
    expect(route[0]![0]).toBeGreaterThanOrEqual(32);
    expect(route.at(-1)).toEqual([100, 0]);
  });

  test("a route clear of every solid is unchanged in shape", () => {
    const route = routeAround(
      [
        [-100, 80],
        [100, 80],
      ],
      [fire],
      10,
    );
    expect(route.every((p) => p[1] === 80)).toBe(true);
  });
});
