// The ground's per-pixel colour, apart from the canvas: water / sand / grass /
// hills coloured from the island heights, and the water mask (where animated
// water may paint). Pure arithmetic over the world into byte arrays — no DOM —
// so the very same code runs on the page and in the bake workers
// (`bake.worker.ts`): a tile coloured in a worker is bit-identical to one
// coloured here. The texture drawn over it (surf, grass, pebbles, …) is
// canvas work and stays in `ground.ts`.

import {
  fbm,
  hash,
  vnoise,
  type Island,
  type WorldModel,
} from "@plugins/apps/plugins/isle/plugins/world/core";
import { ss } from "./kit";

/** A ground tile's side, world px. */
export const GT = 512;
/** World px per ground pixel: a tile's colour is baked at half resolution (plus a 1 px margin). */
const S = 2;

export type Rgb = [number, number, number];
const hex = (h: string): Rgb => {
  const n = parseInt(h.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
export const mixTo = (o: Rgb, a: Rgb, b: Rgb, t: number): Rgb => {
  o[0] = a[0] + (b[0] - a[0]) * t;
  o[1] = a[1] + (b[1] - a[1]) * t;
  o[2] = a[2] + (b[2] - a[2]) * t;
  return o;
};

export const DEEP_C = hex("#2d6c9b");
export const ABYSS_C = hex("#25608f");
const DRY = hex("#bab27a");
// the meadow's washes
const M_LO = hex("#6c7a44");
const M_HI = hex("#97a35d");
const M_WARM = hex("#aba566");
const M_DAMP = hex("#52653b");
const M_EARTH = hex("#b29e74");
const M_EARTH_D = hex("#877452");
const M_WORN = hex("#a39c63");
const SAND1 = hex("#dccca0");
const SAND2 = hex("#cbb688");
const WET = hex("#b5a47e");
const SHAL = hex("#93c6cf");
const MID = hex("#4f90b8");
const FOAM: Rgb = [236, 242, 238];
const BANK: Rgb = [52, 50, 30];
const HILL_LIT: Rgb = [214, 206, 150];
const HILL_SHADE: Rgb = [58, 64, 34];

/**
 * Where the meadow's turf is worn through to bare earth (above ~0.69): read by
 * the pixel colour here and by the texture drawn over it (`ground.ts`), which
 * thins the grass and scatters stones there.
 */
export const meadowBare = (X: number, Y: number): number =>
  fbm(X / 64 + 31, Y / 64 + 17, 3) * 0.78 +
  fbm(X / 420 + 5, Y / 420 + 50, 2) * 0.3;

export type HeightFn = (x: number, y: number) => number;
type PixelFn = (
  X: number,
  Y: number,
  d: Uint8ClampedArray,
  i: number,
) => number;

/** → (X, Y, data, i): writes the colour of world point (X, Y); `E` = hill elevation. */
function groundPixel(H: HeightFn, E: HeightFn | null): PixelFn {
  const col: Rgb = [0, 0, 0];
  return (X, Y, d, i) => {
    const hv = H(X, Y);
    if (hv < -0.47) {
      d[i + 3] = 0; // open sea: the ocean texture shows through
      return hv;
    }
    const grain = vnoise(X / 3.1, Y / 3.1) - 0.5;
    let alpha = 255;
    if (hv < 0.02) {
      const dep = Math.max(0, -hv);
      const streak = vnoise(X / 70, Y / 14) - 0.5;
      const wob = fbm(X / 90, Y / 90, 2) - 0.5;
      if (dep < 0.1) mixTo(col, SHAL, MID, ss(0, 0.1, dep + wob * 0.04));
      else if (dep < 0.3)
        mixTo(col, MID, DEEP_C, ss(0.1, 0.3, dep + wob * 0.07));
      else mixTo(col, DEEP_C, ABYSS_C, ss(0.3, 0.65, dep));
      for (let k = 0; k < 3; k++) col[k] = col[k]! + streak * 14 + grain * 6;
      if (hv > -0.012) mixTo(col, col, FOAM, ss(-0.012, 0.02, hv) * 0.6);
      alpha = Math.round((1 - ss(0.26, 0.46, dep)) * 255);
    } else if (hv < 0.075) {
      const n = fbm(X / 40, Y / 40, 2);
      mixTo(col, SAND1, SAND2, n);
      if (hv < 0.032) mixTo(col, WET, col, ss(0.02, 0.032, hv));
      for (let k = 0; k < 3; k++) col[k] = col[k]! + grain * 12;
    } else {
      // a meadow: broad soft washes, drier and damper ground, turf worn to earth in places, darker by the water
      const v = fbm(X / 250 + 9, Y / 250, 3);
      const w = fbm(X / 80 + 3, Y / 80 + 7, 3);
      const q = vnoise(X / 18, Y / 18);
      const dry = fbm(X / 170 + 20, Y / 170, 2);
      mixTo(col, M_LO, M_HI, ss(0.28, 0.72, v * 0.62 + w * 0.38));
      if (dry > 0.5) mixTo(col, col, M_WARM, ss(0.5, 0.74, dry) * 0.5);
      const bloom = Math.abs(w - 0.5); // where a wash pooled as it dried
      if (bloom < 0.02) mixTo(col, col, M_LO, (1 - bloom / 0.02) * 0.16);
      const bare = meadowBare(X, Y);
      if (bare > 0.63) {
        mixTo(col, col, M_WORN, ss(0.63, 0.7, bare) * 0.55);
        if (bare > 0.69) {
          mixTo(col, col, M_EARTH, ss(0.69, 0.722, bare) * 0.9);
          if (bare < 0.74)
            mixTo(col, col, M_EARTH_D, ss(0.74, 0.69, bare) * 0.3);
        }
      }
      if (hv < 0.17)
        mixTo(col, col, M_DAMP, ss(0.17, 0.085, hv + (q - 0.5) * 0.025) * 0.62);
      if (hv < 0.084) mixTo(col, col, BANK, ss(0.084, 0.077, hv) * 0.6);
      if (E) {
        const e = E(X, Y);
        if (e > 0.04) {
          // a hill: lit from the north-west, drier on top
          const ex = (E(X + 6, Y) - E(X - 6, Y)) / 12;
          const ey = (E(X, Y + 6) - E(X, Y - 6)) / 12;
          const lit = (-ex - ey * 0.8) * 260;
          if (lit > 0) mixTo(col, col, HILL_LIT, Math.min(0.5, lit * 0.45));
          else mixTo(col, col, HILL_SHADE, Math.min(0.45, -lit * 0.5));
          mixTo(col, col, DRY, ss(0.5, 0.95, e) * 0.28);
        }
      }
      // granulation, and the brush's long strokes
      const tex =
        grain * 13 +
        (vnoise(X / 7.3, Y / 7.3) - 0.5) * 6 +
        (vnoise(X / 52 + w * 3, Y / 7) - 0.5) * 7;
      for (let k = 0; k < 3; k++) col[k] = col[k]! + tex;
    }
    d[i] = col[0];
    d[i + 1] = col[1];
    d[i + 2] = col[2];
    d[i + 3] = alpha;
    return hv;
  };
}

/** The highest island height at a point, over a set of islands (open sea: -1). */
export function heightOver(
  M: WorldModel,
  islands: readonly Island[],
): HeightFn {
  return (X, Y) => M.heightAt(X, Y, islands);
}

/** The highest hill elevation at a point, over the islands that have hills. */
export function elevationOver(
  M: WorldModel,
  islands: readonly Island[],
): HeightFn {
  return (X, Y) => {
    let e = 0;
    for (const I of islands) {
      if (!I.hills.length) continue;
      const b = I.bounds;
      if (X > b[0] && X < b[2] && Y > b[1] && Y < b[3])
        e = Math.max(e, M.elevation(I, X, Y));
    }
    return e;
  };
}

/** The islands whose heights reach tile (tx, ty): their bounds within 140 px of it. */
export function islandsNearTile(
  islands: readonly Island[],
  tx: number,
  ty: number,
): Island[] {
  const X0 = tx * GT;
  const Y0 = ty * GT;
  return islands.filter((I) => {
    const [bx0, by0, bx1, by1] = I.bounds;
    return !(
      bx1 < X0 - 140 ||
      bx0 > X0 + GT + 140 ||
      by1 < Y0 - 140 ||
      by0 > Y0 + GT + 140
    );
  });
}

/** A pixel grid being coloured a band of rows at a time. */
export interface PixelKernel {
  readonly w: number;
  readonly h: number;
  /** RGBA, w × h. */
  readonly img: Uint8ClampedArray<ArrayBuffer>;
  /** Colours rows [y0, y1). */
  rows(y0: number, y1: number): void;
}

/** A ground tile's colour (`img`) and water mask (`mask`, alpha only), (GT / 2 + 2)² px with a 1 px margin. */
export interface GroundKernel extends PixelKernel {
  readonly mask: Uint8ClampedArray<ArrayBuffer>;
}

export function groundKernel(
  M: WorldModel,
  tx: number,
  ty: number,
  near: readonly Island[],
): GroundKernel {
  const X0 = tx * GT;
  const Y0 = ty * GT;
  const n = GT / S + 2;
  const H = heightOver(M, near);
  const E = near.some((J) => J.hills.length) ? elevationOver(M, near) : null;
  const px = groundPixel(H, E);
  const img = new Uint8ClampedArray(n * n * 4);
  const mask = new Uint8ClampedArray(n * n * 4);
  return {
    w: n,
    h: n,
    img,
    mask,
    rows(y0, y1) {
      for (let y = y0; y < y1; y++)
        for (let x = 0; x < n; x++) {
          const i = (y * n + x) * 4;
          const hv = px(X0 + (x - 1) * S, Y0 + (y - 1) * S, img, i);
          mask[i + 3] = Math.round((1 - ss(0, 0.02, hv)) * 255);
        }
    },
  };
}

/** An island's coarse preview, 1 px per {@link PREVIEW_Q} world px, from (x, y). */
export interface PreviewKernel extends PixelKernel {
  readonly x: number;
  readonly y: number;
}

export const PREVIEW_Q = 8;

export function previewKernel(M: WorldModel, I: Island): PreviewKernel {
  const Q = PREVIEW_Q;
  const [bx0, by0, bx1, by1] = I.bounds;
  const X0 = Math.floor(bx0);
  const Y0 = Math.floor(by0);
  const qw = Math.ceil((bx1 - bx0) / Q);
  const qh = Math.ceil((by1 - by0) / Q);
  const px = groundPixel(
    (X, Y) => M.height(I, X, Y),
    (X, Y) => M.elevation(I, X, Y),
  );
  const img = new Uint8ClampedArray(qw * qh * 4);
  return {
    w: qw,
    h: qh,
    x: X0,
    y: Y0,
    img,
    rows(y0, y1) {
      for (let y = y0; y < y1; y++)
        for (let x = 0; x < qw; x++)
          px(X0 + x * Q, Y0 + y * Q, img, (y * qw + x) * 4);
    },
  };
}

/** The open sea's mean colour: what stands in for its texture until that is baked. */
export const OCEAN_FLAT = ((c: Rgb) =>
  `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`)(
  mixTo([0, 0, 0], DEEP_C, ABYSS_C, 0.55),
);

/** The open sea's grain side: one seamless tile of fine tooth, laid over the sea's colour. */
export const OCEAN_N = 512;

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise that wraps every `P` cells, so the texture tiles seamlessly. */
function periodicNoise(x: number, y: number, P: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const m = (n: number) => ((n % P) + P) % P;
  const a = hash(m(xi), m(yi));
  const b = hash(m(xi + 1), m(yi));
  const c = hash(m(xi), m(yi + 1));
  const d = hash(m(xi + 1), m(yi + 1));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * The open sea's grain, {@link OCEAN_N}² px: fine paper tooth only — white or
 * black at a few levels of alpha, laid over the colour `sea.ts` washes in from
 * the world position. Nothing a few px wide can be seen to repeat, and it is
 * the ONLY part of the sea that does: the streaks and the slow drift between
 * the blues, once baked into this tile (and so repeating every 128 px down the
 * page as rows of the same dashes), are placed in world space instead. The
 * same for every world — 262k pixels, so it bakes like a tile (a worker, else
 * a slice of rows per frame), never in the task that opens the island.
 */
export function oceanKernel(): PixelKernel {
  const N = OCEAN_N;
  const img = new Uint8ClampedArray(N * N * 4);
  return {
    w: N,
    h: N,
    img,
    rows(y0, y1) {
      for (let y = y0; y < y1; y++)
        for (let x = 0; x < N; x++) {
          const grain = periodicNoise(x / 3.2, y / 3.2, 160) - 0.5;
          const i = (y * N + x) * 4;
          const v = grain > 0 ? 255 : 0;
          img[i] = v;
          img[i + 1] = v;
          img[i + 2] = v;
          img[i + 3] = Math.round(Math.abs(grain) * (grain > 0 ? 20 : 30));
        }
    },
  };
}
