import { describe, expect, test } from "bun:test";
import {
  boxField,
  cheapestWay,
  fair,
  meander,
  pathNet,
  resampled,
} from "./footpath";
import type { Pt } from "./geometry";

const corner: Pt[] = [
  [0, 0],
  [200, 0],
  [200, 200],
];

describe("footpaths", () => {
  test("a resampled line keeps its ends and steps evenly", () => {
    const r = resampled(corner, 8);
    expect(r[0]).toEqual([0, 0]);
    expect(r[r.length - 1]).toEqual([200, 200]);
    for (let i = 1; i < r.length; i++) {
      const d = Math.hypot(r[i]![0] - r[i - 1]![0], r[i]![1] - r[i - 1]![1]);
      expect(d).toBeGreaterThan(3.9);
      expect(d).toBeLessThan(12.1);
    }
  });

  test("a worn corner is rounded, within each point's reach, ends kept", () => {
    const base = resampled(corner, 8);
    const caps = base.map((_, i) => (i % 2 ? 30 : 12));
    const f = fair(base, caps, 80);
    expect(f[0]).toEqual(base[0]!);
    expect(f[f.length - 1]).toEqual(base[base.length - 1]!);
    let moved = 0;
    f.forEach((p, i) => {
      const d = Math.hypot(p[0] - base[i]![0], p[1] - base[i]![1]);
      expect(d).toBeLessThanOrEqual(caps[i]! + 1e-9);
      moved = Math.max(moved, d);
    });
    expect(moved).toBeGreaterThan(8); // the corner really was cut
    // no reach: the routed line itself
    expect(
      fair(
        base,
        base.map(() => 0),
        80,
      ),
    ).toEqual(base);
  });

  test("a wander stays within its amplitude and leaves the ends alone", () => {
    const base = resampled(corner, 8);
    const m = meander(
      base,
      base.map(() => 10),
    );
    expect(m[0]).toEqual(base[0]!);
    expect(m[m.length - 1]).toEqual(base[base.length - 1]!);
    m.forEach((p, i) =>
      expect(
        Math.hypot(p[0] - base[i]![0], p[1] - base[i]![1]),
      ).toBeLessThanOrEqual(10 * 1.25 * Math.SQRT2),
    );
  });

  test("the net answers the nearest laid point; the box field the nearest box", () => {
    const net = pathNet();
    net.add([
      [0, 0],
      [100, 0],
    ]);
    expect(net.nearest(50, 80, 40)).toBeNull();
    const q = net.nearest(50, 20, 40)!;
    expect(q.d).toBeCloseTo(20, 0);
    const F = boxField(
      [
        [0, 0, 10, 10],
        [100, 0, 110, 10],
      ],
      60,
    );
    expect(F.dist(30, 5)).toBe(20);
    expect(F.dist(30, 5, 0)).toBe(60);
    expect(F.dist(5, 5)).toBe(0);
  });

  test("the cheapest way goes round what is in its way, taut, to the nearest road", () => {
    const net = pathNet();
    net.add([
      [-400, -200],
      [400, -200],
    ]);
    // a wall across the straight way north, open at its west end only
    const free = (x: number, y: number) =>
      !(y > -110 && y < -90 && x > -120 && x < 300);
    const way = cheapestWay([0, 0], free, (x, y) => net.at(x, y), 600)!;
    expect(way[0]).toEqual([0, 0]);
    const end = way[way.length - 1]!;
    expect(Math.abs(end[1] + 200)).toBeLessThan(8);
    for (const [x, y] of resampled(way, 4)) expect(free(x, y)).toBe(true);
    let len = 0;
    for (let i = 1; i < way.length; i++)
      len += Math.hypot(
        way[i]![0] - way[i - 1]![0],
        way[i]![1] - way[i - 1]![1],
      );
    // round the wall's west end (about 156 + 100), nothing like the east way
    expect(len).toBeGreaterThan(245);
    expect(len).toBeLessThan(290);
    expect(way.length).toBeLessThan(7);
    // out of reach: no way
    expect(cheapestWay([0, 0], free, (x, y) => net.at(x, y), 150)).toBeNull();
    // the same question, the same answer
    expect(cheapestWay([0, 0], free, (x, y) => net.at(x, y), 600)).toEqual(way);
  });
});
