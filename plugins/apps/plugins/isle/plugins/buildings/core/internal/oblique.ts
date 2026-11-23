// The projection every building is drawn in, in one place. The island is seen
// in a high 3/4 view: a building shows its FRONT flat-on, a sliver of its RIGHT
// side and its top, and everything that goes back into the picture — a side
// wall, a roof plane, the top of a crate, a step's tread, the foot of a wall on
// the grass — recedes along ONE vector: `d` px of depth move a point `d` px
// right and `SLANT·d` px up. Nothing else may spell that vector.
//
// A building does not draw a side face by hand: it declares a volume (a front
// rectangle or edge + a depth) and gets its faces back, or paints "in face
// space" (`onSide`, `onTop`, `onSlope`), where what it draws flat — courses,
// boards, a window, a door — is sheared onto the face. `perspectiveProblems`
// (core/testing, run by `testBuildingFootprint`) fails a building that fills
// or clips a polygon with a receding-looking edge the kit did not produce.

import type { Box, Ctx2D } from "../spec";
import { bbox, poly, type Pt } from "./draw";
import { withinProjection } from "./projection-scope";

/** How much a receding edge rises per px it runs to the right. */
const SLANT = 0.7;
/** One px of depth, on screen. */
const DEPTH: Pt = [1, -SLANT];
/** How flat a horizontal circle reads: its vertical radius per px of horizontal radius. */
const ROUND = 0.3;

declare const faceBrand: unique symbol;
/** A polygon the projection produced: only `oblique` makes one, and only `oblique.fill` paints one. */
export type Face = readonly Pt[] & { readonly [faceBrand]: true };

const face = (pts: readonly Pt[]): Face => pts as Face;

const within = (g: Ctx2D, draw: () => void): void => withinProjection(g, draw);

/** The point `d` px behind `p`. */
const back = (p: Pt, d: number): Pt => [p[0] + d, p[1] - SLANT * d];

/** A point in space: `x` across, `z` px back from the front plane, `h` px above the ground line. */
export type P3 = readonly [x: number, z: number, h: number];

/** Where the point `x` across, `z` back and `h` up is on screen. */
const at = (x: number, z: number, h: number): Pt => [x + z, -h - SLANT * z];

/**
 * The face a polygon in space shows: for a shape no box or extrusion gives (a
 * curved plan, a propped lid), spelled as 3D points and projected here.
 */
const project = (pts: readonly P3[]): Face =>
  face(pts.map(([x, z, h]) => at(x, z, h)));

/** How far up a point `d` px deep sits (px, positive). */
const rise = (d: number): number => SLANT * d;

/** The vertical radius of a horizontal circle of radius `rx` (a drum's rim, a round base). */
const ry = (rx: number): number => rx * ROUND;

/**
 * The face a front edge `a → b` sweeps as it goes `d` px back: a side wall
 * (a vertical edge), a top (a horizontal one), a roof plane (a sloping one).
 */
const extrude = (a: Pt, b: Pt, d: number): Face =>
  face([a, back(a, d), back(b, d), b]);

/** The right side wall of a front whose right edge is at `x`, from `yb` up to `yt`. */
const sideFace = (x: number, yb: number, yt: number, d: number): Face =>
  extrude([x, yb], [x, yt], d);

/** The top of a front from `x0` to `x1` whose top edge is at `y`. */
const topFace = (x0: number, x1: number, y: number, d: number): Face =>
  face([[x0, y], [x1, y], back([x1, y], d), back([x0, y], d)]);

/** A box: its front from (x0, yb) to (x1, yt), `d` deep. */
export interface BoxGeom {
  readonly x0: number;
  readonly x1: number;
  /** The foot (larger y) and the top. */
  readonly yb: number;
  readonly yt: number;
  readonly d: number;
}

export interface BoxFaces {
  readonly front: Face;
  readonly side: Face;
  readonly top: Face;
  /** The side wall's foot: where it meets the ground (or the tier below). */
  readonly foot: readonly [Pt, Pt];
  /** The box of all three faces. */
  readonly bounds: Box;
}

/** The three faces of a box seen in the island's view. */
function box(o: BoxGeom): BoxFaces {
  const front = face([
    [o.x0, o.yb],
    [o.x1, o.yb],
    [o.x1, o.yt],
    [o.x0, o.yt],
  ]);
  const side = sideFace(o.x1, o.yb, o.yt, o.d);
  const top = topFace(o.x0, o.x1, o.yt, o.d);
  return {
    front,
    side,
    top,
    foot: [[o.x1, o.yb], back([o.x1, o.yb], o.d)],
    bounds: bbox([...front, ...side, ...top]),
  };
}

/** A roof over a front from `x0` to `x1` at eave height `y`, on a body `d` deep. */
export interface RoofGeom {
  readonly x0: number;
  readonly x1: number;
  readonly y: number;
  readonly d: number;
  /** How high the ridge or apex stands above the eave. */
  readonly rise: number;
}

/**
 * A gabled roof whose ridge runs along the front: the front `slope` (eave up
 * to the ridge, which sits half the depth back), the right `gable` end and
 * the `ridge` line.
 */
function gableRoof(o: RoofGeom): {
  slope: Face;
  gable: Face;
  ridge: readonly [Pt, Pt];
} {
  const up = (x: number): Pt => {
    const p = back([x, o.y], o.d / 2);
    return [p[0], p[1] - o.rise];
  };
  const r0 = up(o.x0);
  const r1 = up(o.x1);
  return {
    slope: face([[o.x0, o.y], [o.x1, o.y], r1, r0]),
    gable: face([[o.x1, o.y], back([o.x1, o.y], o.d), r1]),
    ridge: [r0, r1],
  };
}

/**
 * A roof whose gable faces the viewer: the `front` triangle (apex over `ax`,
 * default the middle), the right `slope` going back from it and the `ridge`.
 */
function gableFront(o: RoofGeom & { readonly ax?: number }): {
  front: Face;
  slope: Face;
  ridge: readonly [Pt, Pt];
} {
  const apex: Pt = [o.ax ?? (o.x0 + o.x1) / 2, o.y - o.rise];
  return {
    front: face([[o.x0, o.y], [o.x1, o.y], apex]),
    slope: extrude([o.x1, o.y], apex, o.d),
    ridge: [apex, back(apex, o.d)],
  };
}

/** A hipped (pyramid) roof: its `front` and right `side` planes meeting at the `apex` over the body's middle. */
function hipRoof(o: RoofGeom): { front: Face; side: Face; apex: Pt } {
  const m = back([(o.x0 + o.x1) / 2, o.y], o.d / 2);
  const apex: Pt = [m[0], m[1] - o.rise];
  return {
    front: face([[o.x0, o.y], [o.x1, o.y], apex]),
    side: face([[o.x1, o.y], back([o.x1, o.y], o.d), apex]),
    apex,
  };
}

/** What an outline shows of its thickness: see {@link rim}. */
export interface Rim {
  /**
   * The receding faces the view shows, one per visible segment, far to near
   * along the outline; `up` says how much each faces the sky (1: a top, lit;
   * 0: a side, in shade).
   */
  readonly faces: readonly { readonly face: Face; readonly up: number }[];
  /** The face EVERY segment sweeps, seen or not: together, all the room the thickness takes behind the front. */
  readonly swept: readonly Face[];
  /** The ink of the visible thickness: each run's far edge, with the crease at either end back to the front. */
  readonly edges: readonly (readonly Pt[])[];
}

/**
 * The thickness of a shape that is no box: a front `outline` (a jigsaw knob,
 * a cog, a keyhole plate, a letter) going `d` px back. The outline runs
 * CLOCKWISE on screen — the outside on the left of travel — open (a knob on
 * an edge) or `closed` (a whole plate). Of the band it sweeps, the view shows
 * what faces right or up: for a knob that is its top and right flank, for a
 * notch cut INTO a body its left wall and floor. Paint the rim, then the
 * front over it (`paintRim`).
 */
function rim(outline: readonly Pt[], d: number, closed = false): Rim {
  const n = outline.length;
  const segs = closed ? n : n - 1;
  const faces: { face: Face; up: number }[] = [];
  const swept: Face[] = [];
  const edges: Pt[][] = [];
  let run: Pt[] | null = null;
  const end = (p: Pt) => {
    if (!run) return;
    run.push(back(p, d), p);
    edges.push(run);
    run = null;
  };
  for (let i = 0; i < segs; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % n]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    if (l === 0) continue;
    const f = extrude(a, b, d);
    swept.push(f);
    // the outward normal is (dy, -dx): seen when it leans along the receding vector's own side (right, or up)
    if (dy + SLANT * dx > 1e-9) {
      faces.push({ face: f, up: Math.max(0, dx / l) });
      if (!run) run = [a];
      run.push(back(a, d));
    } else end(a);
  }
  end(closed ? outline[0]! : outline[n - 1]!);
  return { faces, swept, edges };
}

/**
 * Paints a {@link rim}: every visible face in the colour `col(up)` gives it
 * (seams closed with a hairline of the same colour), then its ink.
 */
function paintRim(
  g: Ctx2D,
  r: Rim,
  col: (up: number) => string,
  lw = 1.2,
): void {
  within(g, () => {
    g.save();
    g.lineJoin = g.lineCap = "round";
    for (const { face: f, up } of r.faces) {
      poly(g, f);
      g.fillStyle = g.strokeStyle = col(up);
      g.lineWidth = 0.6;
      g.fill();
      g.stroke();
    }
    if (lw) {
      g.strokeStyle = "rgba(48,38,28,.85)";
      g.lineWidth = lw;
      for (const e of r.edges) {
        g.beginPath();
        e.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
      }
    }
    g.restore();
  });
}

/**
 * Paints a face: `draw` is handed its points (to trace, clip, wash, tile…).
 * The only way to put ink on a receding polygon.
 */
function fill(g: Ctx2D, f: Face, draw: (pts: readonly Pt[]) => void): void {
  within(g, () => draw(f));
}

/** Darkens a face (a side in shade), by `a`. */
function shadeFace(g: Ctx2D, f: Face, a = 0.34): void {
  within(g, () => {
    poly(g, f);
    g.fillStyle = `rgba(30,26,20,${a})`;
    g.fill();
  });
}

/** Inks a face's outline. */
function inkFace(g: Ctx2D, f: Face, w = 1.2, a = 0.85): void {
  within(g, () => {
    poly(g, f);
    g.strokeStyle = `rgba(48,38,28,${a})`;
    g.lineWidth = w;
    g.lineJoin = g.lineCap = "round";
    g.stroke();
  });
}

/**
 * Side-face space: inside `draw`, x is the DEPTH behind the front's right edge
 * at `x` (0 on the edge, growing into the picture) and y is unchanged — so a
 * wall painted flat from x = 0 to x = d (its courses, boards, a window, a
 * door, its shade) comes out as the receding side.
 */
function onSide(g: Ctx2D, x: number, draw: () => void): void {
  g.save();
  g.transform(1, -SLANT, 0, 1, x, 0);
  within(g, draw);
  g.restore();
}

/**
 * Top-face space: inside `draw`, x is unchanged and y is the DEPTH behind the
 * front's top edge at `y` (0 on the edge, growing into the picture) — a deck,
 * a tread, a lid painted flat from y = 0 to y = d.
 */
function onTop(g: Ctx2D, y: number, draw: () => void): void {
  g.save();
  g.transform(1, 0, 1, -SLANT, 0, y);
  within(g, draw);
  g.restore();
}

/**
 * The space of the plane a front edge `a → b` sweeps going back (a roof
 * slope): inside `draw`, x is the depth behind the edge and y the distance
 * from `a` toward `b`, in px.
 */
function onSlope(g: Ctx2D, a: Pt, b: Pt, draw: () => void): void {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  g.save();
  g.transform(1, -SLANT, (b[0] - a[0]) / l, (b[1] - a[1]) / l, a[0], a[1]);
  within(g, draw);
  g.restore();
}

/**
 * A diagonal that is NOT a receding edge though it lies near the receding
 * direction (a roof pitch, a brace, a jib, a fin): `draw` is exempt from the
 * perspective test. Say why at the call.
 */
function diagonal(g: Ctx2D, draw: () => void): void {
  within(g, draw);
}

export interface SolidPaint {
  /** Paints the front, flat: handed its box `[x0, yt, x1, yb]`. */
  front(b: Box): void;
  /** Paints the side in side-face space: flat from x = 0 to `d`, y from `yt` to `yb`. Default: no side painted (only shade and ink). */
  side?(d: number, yt: number, yb: number): void;
  /** Paints the top in top-face space: x from `x0` to `x1`, y from 0 to `d`. Omitted: something stands on it. */
  top?(x0: number, x1: number, d: number): void;
  /** How dark the side is (default 0.34; 0: none). */
  shade?: number;
  /** Outline width (default 1.3; 0: none). */
  ink?: number;
}

/**
 * Paints a box: the side (sheared, then shaded), the top, the front, their
 * outlines. Returns its faces.
 */
function solid(g: Ctx2D, o: BoxGeom, p: SolidPaint): BoxFaces {
  const f = box(o);
  const lw = p.ink ?? 1.3;
  const side = p.side;
  if (side) onSide(g, o.x1, () => side(o.d, o.yt, o.yb));
  if ((p.shade ?? 0.34) > 0) shadeFace(g, f.side, p.shade ?? 0.34);
  const top = p.top;
  if (top) {
    onTop(g, o.yt, () => top(o.x0, o.x1, o.d));
    if (lw) inkFace(g, f.top, lw * 0.9);
  }
  if (lw) inkFace(g, f.side, lw * 0.9);
  p.front([o.x0, o.yt, o.x1, o.yb]);
  if (lw) inkFace(g, f.front, lw);
  return f;
}

/** Contact darkness where a box meets the ground: along the front's foot and the side's. */
function contact(g: Ctx2D, o: BoxGeom, a = 0.3): void {
  const far = back([o.x1, o.yb], o.d);
  within(g, () => {
    g.save();
    g.strokeStyle = `rgba(34,36,20,${a})`;
    g.lineWidth = 3;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(o.x0, o.yb + 1);
    g.lineTo(o.x1, o.yb + 1);
    g.lineTo(far[0], far[1] + 1);
    g.stroke();
    g.restore();
  });
}

/**
 * The island's 3/4 projection: the one receding vector, the faces of volumes
 * (box, extruded edge, roofs), the face spaces details are painted in, and
 * `solid` (a box painted in one call). Namespaced.
 */
export const oblique = {
  SLANT,
  DEPTH,
  ROUND,
  back,
  at,
  project,
  rise,
  ry,
  extrude,
  sideFace,
  topFace,
  box,
  gableRoof,
  gableFront,
  hipRoof,
  rim,
  paintRim,
  fill,
  shadeFace,
  inkFace,
  onSide,
  onTop,
  onSlope,
  diagonal,
  solid,
  contact,
} as const;
