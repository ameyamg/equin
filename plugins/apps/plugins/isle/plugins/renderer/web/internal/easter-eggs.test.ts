import { describe, expect, test } from "bun:test";
import type { Pt } from "@plugins/apps/plugins/isle/plugins/world/core";
import { wolfWood, WOLF_BOX, type WoodTree } from "./easter-eggs";

/** A tree at its foot (x, y): a crown 70 px wide, 120 px tall. */
const tree = (x: number, y: number): WoodTree => ({
  x,
  y,
  x0: x - 35,
  y0: y - 120,
  x1: x + 35,
  y1: y + 4,
});

/** A stand of n×n trees, `gap` px apart, its corner at (x, y). */
const stand = (x: number, y: number, n: number, gap = 60): WoodTree[] =>
  Array.from({ length: n * n }, (_, i) =>
    tree(x + (i % n) * gap, y + ((i / n) | 0) * gap),
  );

const everywhere = () => true;

/** How much of the werewolf's box at (x, y) the trees in front of it cover. */
const covered = (trees: readonly WoodTree[], [x, y]: Pt) => {
  const [bx0, by0, bx1] = WOLF_BOX;
  let c = 0;
  for (const o of trees) {
    if (o.y <= y) continue;
    const w = Math.min(x + bx1, o.x1) - Math.max(x + bx0, o.x0);
    const h = Math.min(y, o.y1) - Math.max(y + by0, o.y0);
    if (w > 0 && h > 0) c += w * h;
  }
  return c / ((bx1 - bx0) * -by0);
};

describe("wolfWood", () => {
  const houses: Pt[] = [
    [0, 0],
    [100, 40],
  ];

  test("takes the wood far from the houses, not the bigger one beside them", () => {
    const wood = wolfWood(
      [...stand(-100, -100, 6), ...stand(900, 900, 4)],
      houses,
      everywhere,
    );
    expect(wood).not.toBeNull();
    for (const [x, y] of wood!.path) {
      expect(x).toBeGreaterThanOrEqual(860);
      expect(y).toBeGreaterThanOrEqual(880);
    }
  });

  test("every step of its prowl is far from every house", () => {
    const wood = wolfWood(stand(-500, -500, 12), houses, everywhere)!;
    for (const [x, y] of wood.path)
      for (const [hx, hy] of houses)
        expect(Math.hypot(x - hx, y - hy)).toBeGreaterThanOrEqual(380);
  });

  test("it is seen most of the way: hidden only on its tucks behind a trunk", () => {
    const trees = stand(900, 900, 6);
    const { path } = wolfWood(trees, houses, everywhere)!;
    const open = path.filter((p) => covered(trees, p) <= 0.25);
    expect(open.length).toBeGreaterThanOrEqual(3);
    expect(open.length / path.length).toBeGreaterThan(0.6);
  });

  test("its open spots are all on walkable ground", () => {
    const { path } = wolfWood(stand(900, 900, 5), houses, (x) => x < 1050)!;
    // a spot stands 22 px in front of its tree (a tuck, 8 px behind one)
    const spots = path.filter(([, y]) => (y - 900) % 60 === 22);
    expect(spots.length).toBeGreaterThanOrEqual(3);
    for (const [x] of spots) expect(x).toBeLessThan(1050);
  });

  test("no wood far enough from the houses: none", () => {
    expect(wolfWood(stand(-100, -100, 5), houses, everywhere)).toBeNull();
    expect(
      wolfWood([tree(2000, 2000), tree(2050, 2000)], houses, everywhere),
    ).toBeNull();
  });

  test("the same trees give the same wood", () => {
    const trees = stand(900, 900, 4);
    expect(wolfWood(trees, houses, everywhere)!.key).toBe(
      wolfWood(trees, houses, everywhere)!.key,
    );
  });
});
