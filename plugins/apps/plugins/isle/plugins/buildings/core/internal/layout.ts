// Plan-derived geometry shared by painting and the declared footprint, so the
// two cannot drift apart: wall heights, the lean-to, the window slots, the
// roof's key lines, where the props and the sign stand.

import type { Box, Door } from "../spec";
import { bbox, type Pt } from "./draw";
import { oblique, type Face } from "./oblique";
import type { Plan, RoofForm, Wall } from "./plan";

/** How deep a generated building is: how far its right side wall, its roof and its lean-to go back. */
export const SIDE_D = 18;

export const isRound = (p: Plan): boolean =>
  p.arch === "tower" || p.arch === "hut";

/** Height of the walls (tower: the whole shaft; hut: the drum under the dome). */
export function wallHeight(p: Plan): number {
  return isRound(p)
    ? p.arch === "tower"
      ? p.towerH
      : 48
    : p.storeys === 2
      ? 96
      : 60;
}

export const doorHeight = (p: Plan): number =>
  p.arch === "tower" ? 40 : p.arch === "hut" ? 36 : 42;

/** The storehouse has wide double doors instead of a door (width 0). */
export const doorWidth = (p: Plan): number =>
  p.arch === "storehouse" ? 0 : 22;

/** The storehouse's double doors, always swung back: the opening's size. */
export const storehouseOpening = (p: Plan): { w: number; h: number } => ({
  w: Math.min(64, p.W2),
  h: Math.min(54, wallHeight(p) - 8),
});

/** The building's door, as the engine opens it. */
export const doorOf = (p: Plan): Door =>
  p.arch === "storehouse"
    ? { kind: "opening", ...storehouseOpening(p), head: 0 }
    : {
        kind: "leaf",
        w: doorWidth(p),
        h: doorHeight(p),
        head: p.arched ? doorWidth(p) / 2 : 0,
      };

/** The soft cast shadow polygon on the ground beside the body. */
export function shadowPts(p: Plan): Pt[] {
  const { W2 } = p;
  const wallH = wallHeight(p);
  const WT = -wallH;
  return isRound(p)
    ? [
        [-W2 + 6, 3],
        [W2, 3],
        [W2 + 36, 18],
        [W2 + 22, Math.max(WT * 0.3, -50)],
        [W2, Math.max(WT * 0.4, -60)],
      ]
    : [
        [-W2 + 6, 3],
        [W2, 3],
        [W2 + 34, 18],
        [W2 + 20, -wallH * 0.45],
        [W2, -wallH * 0.6],
      ];
}

export interface Annex {
  readonly x0: number;
  readonly x1: number;
  /** Wall height. */
  readonly h: number;
  /** The wall material (a workshop's bay is open; logs become planks there). */
  readonly wall: Wall;
  /** The lean-to roof: the plane its sloping front edge (the verge) sweeps going back. */
  readonly roof: Face;
  /** The wall under the verge, above the wall's square top. */
  readonly gable: readonly Pt[];
  /** The x of its free right end (a lean-to on the right shows that end receding), or null. */
  readonly endX: number | null;
}

/** The lean-to beside the body, or null. */
export function annexOf(p: Plan): Annex | null {
  const a = p.annex;
  if (!a) return null;
  const wallH = wallHeight(p);
  const x0 = a < 0 ? -p.W2 - p.annexW : p.W2 - 4;
  const x1 = a < 0 ? -p.W2 + 4 : p.W2 + p.annexW;
  const h = Math.round(wallH * 0.62);
  // the verge runs from high on the body's wall down to the outer eave
  const lo: Pt = [a < 0 ? x0 - 8 : x1 + 8, -h + 4];
  const hi: Pt = [a < 0 ? x1 : x0, -h - 22];
  const roof =
    a < 0 ? oblique.extrude(lo, hi, SIDE_D) : oblique.extrude(hi, lo, SIDE_D);
  const xw = a < 0 ? x0 : x1;
  const yv = hi[1] + ((xw - hi[0]) / (lo[0] - hi[0])) * (lo[1] - hi[1]);
  const gable: Pt[] = [[hi[0], -h], hi, [xw, yv], [xw, -h]];
  const wall: Wall =
    p.arch === "workshop" && p.wall === "logs" ? "planks" : p.wall;
  return { x0, x1, h, wall, roof, gable, endX: a > 0 ? x1 : null };
}

export interface WindowSlot {
  /** Left edge of the opening. */
  readonly x: number;
  /** Bottom of the opening. */
  readonly y: number;
  readonly h: number;
}

/** The window count per side of the door. */
export const windowsPerSide = (W2: number): number =>
  Math.max(1, Math.round((W2 * 2 - 40) / 46));

/** The windows of a rectangular body: the ground-floor row, then the upper row. */
export function windowSlots(p: Plan): WindowSlot[] {
  const WT = -wallHeight(p);
  const nW = windowsPerSide(p.W2);
  const out: WindowSlot[] = [];
  const row = (yb: number, h: number) => {
    for (let i = 0; i < nW * 2; i++) {
      const side = i < nW ? -1 : 1;
      const k = i % nW;
      const wx = side * (24 + 14 + k * 46) - 12;
      if (Math.abs(wx + 12) + 14 > p.W2 - 4) continue;
      out.push({ x: wx, y: yb, h });
    }
  };
  row(-20, 26);
  if (p.storeys === 2) row(WT / 2 - 10, 24);
  return out;
}

/** The side wall's narrow windows: the bottom y of each (none where a lean-to stands against the wall). */
export function sideWindows(p: Plan): number[] {
  const out: number[] = [];
  if (p.annex <= 0) out.push(-20);
  if (p.storeys === 2) out.push(-wallHeight(p) / 2 - 10);
  return out;
}

/** The roof of a rectangular body over x ∈ [x0, x1] whose eave is at `eaveY`. */
export interface RoofShape {
  readonly form: RoofForm;
  readonly x0: number;
  readonly x1: number;
  readonly eaveY: number;
  readonly W: number;
  readonly cx: number;
  /** Eave overhang. */
  readonly ov: number;
  /** Roof rise. */
  readonly rh: number;
  /** Ridge y. */
  readonly top: number;
  /** Hip inset of the ridge at each end. */
  readonly inset: number;
  /** Gable-front: the gable's height, the roof's depth, the gable apex. */
  readonly gh: number;
  readonly D: number;
  readonly ax: number;
  readonly ay: number;
  /** Gambrel: the knee. */
  readonly kneeY: number;
  readonly k: number;
  /** The ridge cap's extent. */
  readonly ra: number;
  readonly rb: number;
  /** Where the chimney stands on the roof. */
  readonly chimX: number;
  readonly chimY: number;
  /** The highest ink the roof reaches. */
  readonly topY: number;
  /** The planes that show from the front, lowest first (the first one carries the eave). */
  readonly planes: readonly Face[];
  /** The right end, receding: a gable wall (`endIsWall`) or a roof plane; null when the right slope is the end. */
  readonly end: Face | null;
  readonly endIsWall: boolean;
  /** Which of `planes` face away from the light (the right slope of a gable-front roof). */
  readonly shaded: readonly Face[];
  /** The ridge line. */
  readonly ridge: readonly [Pt, Pt];
  /** The box round every plane. */
  readonly box: Box;
  readonly dormers: readonly { readonly dx: number; readonly dy: number }[];
}

/**
 * A roof plane from the points the projection placed (`oblique.back` /
 * `extrude` above): the roof's planes are faces of the projected volume.
 */
const faceOf = (pts: readonly Pt[]): Face =>
  oblique.project(pts.map(([x, y]) => [x, 0, -y]));

export function roofShape(
  p: Plan,
  x0: number,
  x1: number,
  eaveY: number,
): RoofShape {
  const W = x1 - x0;
  const cx = (x0 + x1) / 2;
  const ov = 12;
  const rh = Math.round(W * (p.roof === "thatch" ? 0.42 : 0.36));
  const top = eaveY - rh;
  const gh = Math.round(W * 0.34);
  const D = Math.round(rh * 0.9);
  const ay = eaveY - gh;
  let inset = 4;
  if (p.roofForm === "hip") inset = W * 0.3;
  if (p.roofForm === "halfhip") inset = W * 0.14;
  const gambrel = p.roofForm === "gambrel";
  const dormers: { dx: number; dy: number }[] = [];
  for (let i = 0; i < p.dormers; i++) {
    dormers.push({
      dx:
        p.dormers === 1
          ? cx + (p.chimney ? -p.chimney * W * 0.12 : 0)
          : cx + (i ? 1 : -1) * W * 0.22,
      dy: eaveY - rh * 0.3,
    });
  }
  const front = p.roofForm === "gablefront";
  // every plane is placed by the projection: the ridge of a roof along the front stands half the depth back
  const half = SIDE_D / 2;
  let planes: Face[];
  let end: Face | null = null;
  let endIsWall = false;
  let shaded: Face[] = [];
  let ridge: readonly [Pt, Pt];
  let chimX = cx + p.chimney * W * 0.3;
  let chimY = eaveY - rh * 0.55;
  if (front) {
    const fe = eaveY + 6;
    const apex: Pt = [cx, ay - 6];
    const left = oblique.extrude([x0 - ov, fe], apex, SIDE_D);
    const right = oblique.extrude(apex, [x1 + ov, fe], SIDE_D);
    planes = [left, right];
    shaded = [right];
    ridge = [apex, oblique.back(apex, SIDE_D)];
    // the chimney stands on a slope, half way back
    const x = cx + p.chimney * W * 0.28;
    const onEdge = fe + (apex[1] - fe) * (1 - Math.abs(x - cx) / (W / 2 + ov));
    [chimX, chimY] = oblique.back([x, onEdge], half);
  } else {
    const eY = eaveY + 4;
    const a: Pt = [x1 + ov, eY];
    const b = oblique.back(a, SIDE_D);
    const out = gambrel || p.roofForm === "gable" ? -ov : inset;
    const rl: Pt = [x0 + out + half, top];
    const rr: Pt = [x1 - out + half, top];
    ridge = [rl, rr];
    if (gambrel) {
      const q = SIDE_D / 4;
      const kneeY = eaveY - rh * 0.45;
      const kl: Pt = [x0 - ov + q, kneeY];
      const kr: Pt = [x1 + ov + q, kneeY];
      planes = [faceOf([[x0 - ov, eY], a, kr, kl]), faceOf([kl, kr, rr, rl])];
      end = faceOf([a, b, oblique.back(kr, half), rr, kr]);
      endIsWall = true;
    } else {
      planes = [faceOf([[x0 - ov, eY], a, rr, rl])];
      end = faceOf([a, b, rr]);
      endIsWall = p.roofForm === "gable";
    }
  }
  const box = bbox([...planes.flat(), ...(end ?? [])]);
  return {
    form: p.roofForm,
    x0,
    x1,
    eaveY,
    W,
    cx,
    ov,
    rh,
    top,
    inset,
    gh,
    D,
    ax: cx,
    ay,
    kneeY: eaveY - rh * 0.45,
    k: W * 0.1,
    ra: ridge[0][0],
    rb: ridge[1][0],
    chimX,
    chimY,
    topY: box[1] - 1,
    dormers,
    planes,
    end,
    endIsWall,
    shaded,
    ridge,
    box,
  };
}

/** How deep the chimney stack is. */
export const CHIMNEY_D = 8;

/** The chimney's smoke anchor (the chimney's mouth), or null when the building has none. */
export function smokeAnchor(p: Plan): Pt | null {
  if (isRound(p) || !p.chimney) return null;
  const R = roofShape(p, -p.W2, p.W2, -wallHeight(p));
  const [x, y] = oblique.back([R.chimX, R.chimY - 34 - 6], CHIMNEY_D / 2);
  return [x, y];
}

/** The side anchor props stand at (outside the wall, past a lean-to on that side). */
export const propsAnchor = (p: Plan): number =>
  p.side *
  (p.W2 +
    (p.annex === p.side ? p.annexW : 0) +
    14 +
    (p.side > 0 && !isRound(p) ? SIDE_D : 0));

/** The `bounds` box of the grain pass: everything the building paints, with slack. */
export function grainBox(p: Plan): Box {
  const half = p.maxW / 2;
  const wallH = p.arch === "hut" ? 48 : wallHeight(p);
  const top =
    p.arch === "tower"
      ? -(p.towerH + p.W2 * 1.5 + 60)
      : p.arch === "hut"
        ? -(wallH + p.W2 * 1.05 + 60)
        : -(wallH + p.W2 * 2 * 0.42 + 70);
  return [-half - 30, Math.round(top) - 20, half + 50, 46];
}
