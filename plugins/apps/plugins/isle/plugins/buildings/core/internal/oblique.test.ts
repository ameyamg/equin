import { describe, expect, test } from "bun:test";
import { oblique } from "./oblique";
import type { Pt } from "./draw";

/** A square tab on a top edge: up its left flank, across its top, down its right flank (clockwise on screen). */
const KNOB: Pt[] = [
  [0, 0],
  [0, -10],
  [10, -10],
  [10, 0],
];

describe("oblique.rim", () => {
  test("a knob shows its top (lit) and its right flank (in shade), never its left", () => {
    const r = oblique.rim(KNOB, 8);
    expect(r.swept).toHaveLength(3);
    expect(r.faces.map((f) => f.up)).toEqual([1, 0]);
    expect(r.faces[0]!.face).toEqual(oblique.extrude([0, -10], [10, -10], 8));
    expect(r.faces[1]!.face).toEqual(oblique.extrude([10, -10], [10, 0], 8));
    // one run of ink: from the front, back, along the far edge, and home
    expect(r.edges).toEqual([
      [
        [0, -10],
        oblique.back([0, -10], 8),
        oblique.back([10, -10], 8),
        oblique.back([10, 0], 8),
        [10, 0],
      ],
    ]);
  });

  test("a notch cut into a top edge shows its left wall and its floor, never its right wall", () => {
    // the same square, run the other way round: the hollow is on the left of travel
    const notch: Pt[] = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
    ];
    const r = oblique.rim(notch, 8);
    expect(r.faces.map((f) => f.up)).toEqual([0, 1]);
    expect(r.faces[0]!.face).toEqual(oblique.extrude([0, 0], [0, 10], 8));
  });

  test("a closed plate shows the half of its edge that faces right or up", () => {
    const plate: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const r = oblique.rim(plate, 4, true);
    expect(r.swept).toHaveLength(4);
    expect(r.faces.map((f) => f.up)).toEqual([1, 0]);
    expect(r.edges).toHaveLength(1);
  });
});
