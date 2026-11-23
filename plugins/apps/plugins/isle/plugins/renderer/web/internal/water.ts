// The sea's slow life, drawn every frame over the baked ground — never a
// re-bake: waves lapping the beaches (a crest coming in, the swash running up
// the sand and sliding back, the sand left dark and drying), swell glinting
// far out, rings spreading round the boulders that stand in water. Everything
// is a handful of batched strokes over what is in view; each island's
// waterline is found once (one island a frame, the first time it shows) and
// kept as flat numbers. Deterministic: every phase comes from the place.
//
// `drawAfloat` paints what the engine then cuts to the water (each tile's
// mask); `drawShore` paints after that cut, since the swash runs up onto sand.

import {
  hash,
  vnoise,
  type Island,
  type Layout,
  type WorldModel,
} from "@plugins/apps/plugins/isle/plugins/world/core";
import type { Ctx } from "./kit";

/** What the water reads of an island's furniture (`FurnitureStore`). */
export interface ShoreSource {
  of(I: Island): {
    readonly coast: readonly {
      readonly x: number;
      readonly y: number;
      readonly nx: number;
      readonly ny: number;
      readonly ph: number;
    }[];
    readonly rocks: readonly {
      readonly x: number;
      readonly y: number;
      readonly s: number;
      readonly land?: boolean;
    }[];
  };
}

/** Seconds from one wave to the next on a beach. */
const WAVE_S = 8.5;
/** The height where the water meets the sand (`ground-pixels.ts`). */
const WATERLINE = 0.02;
/** The slices of a wave's cycle drawn in one stroke each. */
const NB = 12;
/** Shore numbers per point: x, y, seaward normal, run-up reach (px), phase, half-length. */
const STRIDE = 7;
/** A wave's cycle: coming in until IN, running up the sand until UP, then sliding back. */
const IN = 0.4;
const UP = 0.56;

interface Shore {
  readonly pts: Float32Array;
  /** Boulders standing in water: x, y, size, phase. */
  readonly rocks: Float32Array;
}

function shoreOf(M: WorldModel, I: Island, src: ShoreSource): Shore {
  const F = src.of(I);
  const H = (x: number, y: number) => M.height(I, x, y);
  const out: number[] = [];
  for (const f of F.coast) {
    let x = f.x;
    let y = f.y;
    let nx = f.nx;
    let ny = f.ny;
    let slope = 0;
    // onto the waterline, down the slope (two steps), reading the slope there
    for (let k = 0; k < 2; k++) {
      const gx = (H(x + 4, y) - H(x - 4, y)) / 8;
      const gy = (H(x, y + 4) - H(x, y - 4)) / 8;
      slope = Math.hypot(gx, gy);
      if (slope < 1e-5) break;
      nx = -gx / slope;
      ny = -gy / slope;
      const step = Math.max(-14, Math.min(14, (H(x, y) - WATERLINE) / slope));
      x += nx * step;
      y += ny * step;
    }
    if (slope < 1e-5 || Math.abs(H(x, y) - WATERLINE) > 0.012) continue;
    // how far the swash runs: up a gentle beach further than up a steep bank
    const reach =
      Math.max(3.5, Math.min(13, 0.02 / slope)) *
      (0.7 + vnoise(x / 150 + 7.7, y / 150 + 1.3) * 0.6);
    const ph = vnoise(x / 520 + 3.3, y / 520 + 9.1) * 2.4 + (f.ph / 7) * 0.07;
    out.push(x, y, nx, ny, reach, ph, 7.5 + (f.ph % 1) * 2.5);
  }
  const rocks: number[] = [];
  F.rocks.forEach((rk, i) => {
    if (rk.land || H(rk.x, rk.y) > WATERLINE) return;
    rocks.push(rk.x, rk.y + rk.s * 0.2, rk.s, hash(i, I.id + 77));
  });
  return { pts: new Float32Array(out), rocks: new Float32Array(rocks) };
}

interface Swell {
  readonly x: number;
  readonly y: number;
  readonly len: number;
  readonly a: number;
  readonly ph: number;
  /** Shown while the zoom's share of swells is above this. */
  readonly rank: number;
}

const paths = (n: number) => Array.from({ length: n }, () => new Path2D());

export class WaterLife {
  private readonly shores = new Map<number, Shore>();
  private readonly swells: Swell[] = [];
  private builtAt = -1;

  constructor(
    private readonly M: WorldModel,
    private readonly layout: Layout,
    private readonly src: ShoreSource,
  ) {
    // swell far out: one spot to a 300 px cell of the world, where the water is open
    const [x0, y0, x1, y1] = layout.rect;
    const C = 300;
    for (let j = Math.floor(y0 / C); j <= Math.floor(y1 / C); j++)
      for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) {
        const x = (i + hash(i, j * 3 + 1)) * C;
        const y = (j + hash(i * 3 + 2, j)) * C;
        if (M.heightAt(x, y, layout.islands) > -0.2) continue;
        this.swells.push({
          x,
          y,
          len: 22 + hash(i + 5, j + 9) * 34,
          a: (vnoise(x / 1300 + 90.1, y / 1300 + 14.4) - 0.5) * 1.1,
          ph: hash(i + 11, j + 13) * 40,
          rank: hash(i + 17, j + 19),
        });
      }
  }

  /** The island's shore, found the first time it is asked for — one island a frame. */
  private shore(I: Island, frame: number): Shore | null {
    let S = this.shores.get(I.id);
    if (!S && this.builtAt !== frame) {
      this.builtAt = frame;
      this.shores.set(I.id, (S = shoreOf(this.M, I, this.src)));
    }
    return S ?? null;
  }

  private visible(x0: number, y0: number, x1: number, y1: number): Island[] {
    return this.layout.islands.filter((I) => {
      const [bx0, by0, bx1, by1] = I.bounds;
      return !(bx1 < x0 || bx0 > x1 || by1 < y0 || by0 > y1);
    });
  }

  /**
   * On the water (the caller cuts it to the tiles' water masks): each wave's
   * crest coming in to the beach, swell glints far out, rings round the rocks.
   * `frame` is the engine's frame number.
   */
  drawAfloat(
    g: Ctx,
    t: number,
    z: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    frame = 0,
  ): void {
    g.lineCap = "round";
    const every = z < 0.3 ? 4 : z < 0.45 ? 3 : z < 0.7 ? 2 : 1;
    const NC = 5;
    const crest = paths(NC);
    const rings = paths(4);
    let anyCrest = false;
    let anyRing = false;
    for (const I of this.visible(x0, y0, x1, y1)) {
      const S = this.shore(I, frame);
      if (!S) continue;
      const P = S.pts;
      for (let i = 0; i < P.length; i += STRIDE * every) {
        const x = P[i]!;
        const y = P[i + 1]!;
        if (x < x0 - 40 || x > x1 + 40 || y < y0 - 40 || y > y1 + 40) continue;
        let p = t / WAVE_S + P[i + 5]!;
        p -= Math.floor(p);
        if (p >= IN) continue;
        const q = p / IN;
        const nx = P[i + 2]!;
        const ny = P[i + 3]!;
        // the crest slows as it shoals
        const off = 3 + 24 * (1 - q) * (1 - q * 0.35);
        const cx = x + nx * off;
        const cy = y + ny * off;
        const len = P[i + 6]! * every * (0.75 + q * 0.3);
        const C = crest[Math.min(NC - 1, (q * NC) | 0)]!;
        C.moveTo(cx - ny * len, cy + nx * len);
        C.quadraticCurveTo(
          cx - nx * 2.2,
          cy - ny * 2.2,
          cx + ny * len,
          cy - nx * len,
        );
        anyCrest = true;
      }
      if (z > 0.3) {
        const R = S.rocks;
        for (let i = 0; i < R.length; i += 4) {
          const x = R[i]!;
          const y = R[i + 1]!;
          const s = R[i + 2]!;
          if (x < x0 - 60 || x > x1 + 60 || y < y0 - 40 || y > y1 + 40)
            continue;
          let q = t / 7 + R[i + 3]!;
          q -= Math.floor(q);
          const rr = s * (1.05 + q * 0.7);
          const P2 = rings[Math.min(3, (q * 4) | 0)]!;
          P2.moveTo(x + rr, y);
          P2.ellipse(x, y, rr, rr * 0.45, 0, 0, 6.2832);
          anyRing = true;
        }
      }
    }
    if (anyCrest)
      crest.forEach((C, b) => {
        const q = (b + 0.5) / NC;
        g.strokeStyle = `rgba(248,252,250,${0.08 + q * 0.42})`;
        g.lineWidth = 1.1 + q * 1.3;
        g.stroke(C);
      });
    if (anyRing)
      rings.forEach((P2, b) => {
        const q = (b + 0.5) / 4;
        g.strokeStyle = `rgba(244,250,250,${Math.sin(q * Math.PI) * 0.22})`;
        g.lineWidth = 1.3 - q * 0.5;
        g.stroke(P2);
      });
    // swell: long soft glints that come and go, about as many on screen at any zoom
    const share = Math.min(1, (z / 0.5) ** 2);
    const sw = paths(3);
    let anySwell = false;
    for (const s of this.swells) {
      if (s.rank > share || s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1)
        continue;
      const w = Math.sin(t * 0.42 + s.ph);
      if (w < 0.25) continue;
      const drift = Math.cos(t * 0.42 + s.ph) * -9;
      const L = (s.len * (0.6 + w * 0.4)) / Math.max(0.5, Math.min(1, z * 1.6));
      const ux = Math.cos(s.a);
      const uy = Math.sin(s.a);
      const cx = s.x - uy * drift;
      const cy = s.y + ux * drift;
      const P2 = sw[w > 0.8 ? 2 : w > 0.55 ? 1 : 0]!;
      P2.moveTo(cx - ux * L, cy - uy * L);
      P2.quadraticCurveTo(cx + uy * 3, cy - ux * 3, cx + ux * L, cy + uy * L);
      anySwell = true;
    }
    if (anySwell)
      sw.forEach((P2, b) => {
        g.strokeStyle = `rgba(235,246,250,${0.045 + b * 0.04})`;
        g.lineWidth = (3 + b * 0.5) / Math.max(0.5, Math.min(1, z * 1.6));
        g.stroke(P2);
      });
  }

  /**
   * On the beach, uncut: each wave's swash — a foam edge running up the sand
   * and sliding back — and the sand it leaves wet, darkest as the water goes
   * and drying until the next wave.
   */
  drawShore(
    g: Ctx,
    t: number,
    z: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    frame = 0,
  ): void {
    const every = z < 0.3 ? 4 : z < 0.45 ? 3 : z < 0.7 ? 2 : 1;
    const wetToo = z > 0.22;
    const foam = paths(NB);
    const wet = paths(NB);
    const used = new Uint8Array(NB);
    for (const I of this.visible(x0, y0, x1, y1)) {
      const S = this.shore(I, frame);
      if (!S) continue;
      const P = S.pts;
      for (let i = 0; i < P.length; i += STRIDE * every) {
        const x = P[i]!;
        const y = P[i + 1]!;
        if (x < x0 - 40 || x > x1 + 40 || y < y0 - 40 || y > y1 + 40) continue;
        let p = t / WAVE_S + P[i + 5]!;
        p -= Math.floor(p);
        if (p < IN) continue;
        const b = Math.min(NB - 1, (((p - IN) / (1 - IN)) * NB) | 0);
        const nx = P[i + 2]!;
        const ny = P[i + 3]!;
        const reach = P[i + 4]!;
        const len = P[i + 6]! * every;
        let front: number;
        let ext: number;
        if (p < UP) {
          const q = (p - IN) / (UP - IN);
          front = reach * (1 - (1 - q) * (1 - q));
          ext = front;
        } else {
          const q = (p - UP) / (1 - UP);
          front = reach * (1 - q) ** 1.6;
          ext = reach;
        }
        used[b] = 1;
        // (inland is against the seaward normal)
        const fx = x - nx * front;
        const fy = y - ny * front;
        const F = foam[b]!;
        F.moveTo(fx - ny * len, fy + nx * len);
        F.quadraticCurveTo(
          fx - nx * 1.8,
          fy - ny * 1.8,
          fx + ny * len,
          fy - nx * len,
        );
        if (wetToo) {
          // one soft band: thick round strokes along the shore, half the swash's reach inland
          // (longer than the foam's dash, so neighbours run together)
          const W = wet[b]!;
          const mx = x - nx * (ext * 0.5 + 1);
          const my = y - ny * (ext * 0.5 + 1);
          const wl = len * 1.5;
          W.moveTo(mx - ny * wl, my + nx * wl);
          W.lineTo(mx + ny * wl, my - nx * wl);
        }
      }
    }
    g.lineCap = "round";
    const upBins = ((UP - IN) / (1 - IN)) * NB;
    for (let b = 0; b < NB; b++) {
      if (!used[b]) continue;
      const mid = b + 0.5;
      const back = mid < upBins ? 0 : (mid - upBins) / (NB - upBins);
      if (wetToo) {
        g.strokeStyle = `rgba(104,84,54,${mid < upBins ? 0.15 : 0.17 * (1 - back) ** 1.3})`;
        g.lineWidth = mid < upBins ? 3 + (mid / upBins) * 4.5 : 7.5;
        g.stroke(wet[b]!);
      }
      const a = mid < upBins ? 0.78 : 0.78 * (1 - back) ** 2.2;
      if (a < 0.02) continue;
      g.strokeStyle = `rgba(250,252,250,${a})`;
      g.lineWidth = mid < upBins ? 2.3 : 2.1 - back * 1.3;
      g.stroke(foam[b]!);
    }
  }
}
