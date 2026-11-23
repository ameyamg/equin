// The footprint test every bespoke building runs: paint it by day, at dusk and
// at night, animate it at many moments, open its door (and draw its
// chimney's smoke), measure
// the ink (`paintedExtent`, no canvas) and check it against the DECLARED
// footprint — inside it, and the footprint no bigger than the ink by more than
// a few px a side (an oversized footprint wastes the island).

import { describe, expect, test } from "bun:test";
import { mulberry32 } from "@plugins/packages/plugins/seeded-random/core";
import { fnv1a32 } from "@plugins/packages/plugins/string-hash/core";
import { chimneySmoke, openDoor } from "../internal/parts";
import { shade } from "../shade";
import {
  GROUND_BAND,
  type Box,
  type BuildingSpec,
  type PaintState,
} from "../spec";
import { oblique } from "../internal/oblique";
import {
  handDrawnEdges,
  paintedExtent,
  type PaintedExtent,
} from "./painted-extent";

/** How far a declared side may lie beyond the measured ink, px. */
export const FOOTPRINT_SLACK = 16;

const TIMES = Array.from({ length: 160 }, (_, i) => i * 0.37);
const LIGHTS = [
  { night: false, dusk: false },
  { night: false, dusk: true },
  { night: true, dusk: false },
] as const;

/** The paint state the renderer hands an app's building (its random stream seeded from the app id). */
function stateFor(appId: string, over: Partial<PaintState>): PaintState {
  return {
    t: 0,
    night: false,
    dusk: false,
    hue: "#8a7a5c",
    shade,
    rnd: mulberry32(fnv1a32(appId)),
    glyph: (g, cx, cy, size) =>
      g.fillRect(cx - size / 2, cy - size / 2, size, size),
    ...over,
  };
}

const unite = (a: Box | null, b: Box | null): Box | null =>
  !a
    ? b
    : !b
      ? a
      : [
          Math.min(a[0], b[0]),
          Math.min(a[1], b[1]),
          Math.max(a[2], b[2]),
          Math.max(a[3], b[3]),
        ];

/** All the ink a building paints and animates, in every light, split at the ground band. */
export function measureBuilding(
  spec: BuildingSpec,
  appId: string,
): PaintedExtent {
  let below: Box | null = null;
  let above: Box | null = null;
  const take = (draw: Parameters<typeof paintedExtent>[0]) => {
    const e = paintedExtent(draw, -GROUND_BAND);
    below = unite(below, e.below);
    above = unite(above, e.above);
  };
  for (const light of LIGHTS) {
    take((g) => spec.paint(g, stateFor(appId, light)));
    if (spec.animate ?? spec.ambient)
      for (const t of TIMES)
        take((g) => {
          const s = stateFor(appId, { ...light, t });
          spec.animate?.(g, s);
          spec.ambient?.(g, s);
        });
  }
  // the door, as the renderer opens it
  take((g) => openDoor(g, spec.door));
  // the smoke the renderer draws from its chimney, at its thickest
  const chimney = spec.chimney;
  if (chimney)
    for (const t of TIMES) take((g) => chimneySmoke(g, chimney, t, 1));
  return { below, above };
}

const fmt = (b: Box) => `[${b.map((v) => v.toFixed(1)).join(", ")}]`;

/** What is wrong with a box declared for measured ink: ink outside it, or a side too loose. */
function boxProblems(name: string, declared: Box, ink: Box): string[] {
  const slack = [
    ink[0] - declared[0],
    ink[1] - declared[1],
    declared[2] - ink[2],
    declared[3] - ink[3],
  ];
  const out: string[] = [];
  ["x0", "y0", "x1", "y1"].forEach((side, i) => {
    const s = slack[i]!;
    if (s < 0)
      out.push(
        `${name} ${side}: ink ${-s.toFixed(1)} px outside (ink ${fmt(ink)}, declared ${fmt(declared)})`,
      );
    // the ground box's top is the band line itself whenever ink crosses it
    else if (s > FOOTPRINT_SLACK)
      out.push(
        `${name} ${side}: ${s.toFixed(1)} px looser than the ink (ink ${fmt(ink)}, declared ${fmt(declared)})`,
      );
  });
  return out;
}

/** Every way a building's declared footprint disagrees with its ink (none: it holds). */
export function footprintProblems(spec: BuildingSpec, appId: string): string[] {
  const m = measureBuilding(spec, appId);
  const { ground, upper } = spec.footprint;
  const out: string[] = [];
  if (m.below) out.push(...boxProblems("ground", ground, m.below));
  else out.push("paints nothing on the ground band");
  if (m.above && upper) out.push(...boxProblems("upper", upper, m.above));
  else if (m.above)
    out.push(`paints above the band ${fmt(m.above)} but declares no upper`);
  else if (upper)
    out.push("declares an upper but paints nothing above the band");
  return out;
}

/** How close to the receding direction (degrees) a hand-drawn edge counts as a receding edge, and from what length (px). */
const RECEDING_BAND = 6;
const RECEDING_MIN = 10;

/**
 * Every receding edge a building spells by hand (none: its perspective holds).
 * The island is seen in one 3/4 view, so everything that goes back into the
 * picture recedes along ONE vector, which only the kit's projection
 * (`oblique`) spells: a polygon `paint` fills or clips to whose edge rises to
 * the right within a few degrees of that vector, and that was not produced by
 * the projection, is a hand-drawn side face — parallel to the vector or not,
 * it is one more place to get the view wrong. Declare the volume
 * (`oblique.sideFace` / `box` / `extrude` / a roof, painted with
 * `oblique.fill`) or paint in face space (`oblique.onSide` / `onTop`); a
 * diagonal that is no receding edge at all (a brace, a roof pitch) goes in
 * `oblique.diagonal`.
 */
export function perspectiveProblems(
  spec: BuildingSpec,
  appId: string,
): string[] {
  const want = (Math.atan(oblique.SLANT) * 180) / Math.PI;
  const seen = new Set<string>();
  for (const [x0, y0, x1, y1] of handDrawnEdges((g) =>
    spec.paint(g, stateFor(appId, {})),
  )) {
    const [ax, ay, bx, by] = x0 <= x1 ? [x0, y0, x1, y1] : [x1, y1, x0, y0];
    if (by >= ay || Math.hypot(bx - ax, by - ay) < RECEDING_MIN) continue;
    const angle = (Math.atan2(ay - by, bx - ax) * 180) / Math.PI;
    if (Math.abs(angle - want) > RECEDING_BAND) continue;
    seen.add(
      `a hand-drawn receding edge (${ax.toFixed(0)}, ${ay.toFixed(0)}) → (${bx.toFixed(0)}, ${by.toFixed(0)}) at ${angle.toFixed(1)}° (the view recedes at ${want.toFixed(1)}°)`,
    );
  }
  return [...seen].sort();
}

/**
 * The footprint test's budget. It paints a building 3 times and animates it
 * 480 times on the measuring context: a building whose `animate` draws a lot
 * (three toothed wheels) takes seconds on a host that runs tests at background
 * priority, past bun's 5 s default.
 */
const FOOTPRINT_TEST_MS = 30_000;

/** Registers the footprint suite of one app's building: `testBuildingFootprint("places", lighthouse)`. */
export function testBuildingFootprint(appId: string, spec: BuildingSpec): void {
  describe(`${appId}'s building`, () => {
    test(
      "its declared footprint holds all its ink (day, dusk, night, animated, door open and shut), tightly",
      () => {
        expect(footprintProblems(spec, appId)).toEqual([]);
      },
      FOOTPRINT_TEST_MS,
    );
    test("spells no receding edge by hand: its side faces come from the kit's projection (oblique)", () => {
      expect(perspectiveProblems(spec, appId)).toEqual([]);
    });
    test("paints the same picture from the same app", () => {
      const once = paintedExtent(
        (g) => spec.paint(g, stateFor(appId, {})),
        -GROUND_BAND,
      );
      const again = paintedExtent(
        (g) => spec.paint(g, stateFor(appId, {})),
        -GROUND_BAND,
      );
      expect(again).toEqual(once);
    });
  });
}
