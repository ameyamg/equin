import { describe, expect, test } from "bun:test";
import type { Pt } from "@plugins/apps/plugins/isle/plugins/world/core";
import { wolfWood } from "./easter-eggs";

/** A stand of n×n trees, `gap` px apart, its corner at (x, y). */
const stand = (x: number, y: number, n: number, gap = 60): Pt[] =>
  Array.from(
    { length: n * n },
    (_, i) => [x + (i % n) * gap, y + ((i / n) | 0) * gap] as const,
  );

describe("wolfWood", () => {
  const houses: Pt[] = [
    [0, 0],
    [100, 40],
  ];

  test("takes the wood far from the houses, not the bigger one beside them", () => {
    const wood = wolfWood(
      [...stand(-100, -100, 6), ...stand(900, 900, 3)],
      houses,
    );
    expect(wood).not.toBeNull();
    for (const [x, y] of wood!.path) {
      expect(x).toBeGreaterThanOrEqual(900);
      expect(y).toBeGreaterThanOrEqual(880);
    }
  });

  test("every step of its prowl is far from every house", () => {
    const wood = wolfWood([...stand(-300, -300, 12)], houses)!;
    for (const [x, y] of wood.path)
      for (const [hx, hy] of houses)
        expect(Math.hypot(x - hx, y + 8 - hy)).toBeGreaterThanOrEqual(380);
  });

  test("no wood far enough from the houses: none", () => {
    expect(wolfWood(stand(-100, -100, 5), houses)).toBeNull();
    expect(
      wolfWood(
        [
          [2000, 2000],
          [2050, 2000],
        ],
        houses,
      ),
    ).toBeNull();
  });

  test("the same trees give the same wood", () => {
    const trees = stand(900, 900, 4);
    expect(wolfWood(trees, houses)!.key).toBe(wolfWood(trees, houses)!.key);
  });
});
