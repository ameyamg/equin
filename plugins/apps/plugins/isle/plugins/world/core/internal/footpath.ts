// Footpaths: the routed waypoints of a road (a trunk's joined pieces, a door's
// lane round its plot) worn into the line people actually walk — corners
// rounded, a gentle wander, and a path running close beside another drawn into
// it. The layout applies this once, so what is painted, what the walk grid
// stamps and what the villagers follow are one and the same curve. Every step
// keeps within a few px of the routed line, so the clearances placement
// checked (a plot's band from its road, a lane from a neighbour's band) hold.

import type { Pt } from "./geometry";
import { smoothstep, vnoise } from "./noise";

/** The grid a door's way is searched on, px. */
export const STEP = 8;

/** An exact key for a grid cell (no two cells share one, within ±32768 cells of the origin). */
export const cellKey = (i: number, j: number): number =>
  (i + 32768) * 65536 + (j + 32768);

/** A polyline resampled at even steps of about `step` px; its ends are kept. */
export function resampled(pts: readonly Pt[], step: number): Pt[] {
  if (pts.length < 2) return [...pts];
  const out: Pt[] = [pts[0]!];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-6) continue;
    let s = step - carry;
    for (; s <= L; s += step)
      out.push([ax + ((bx - ax) * s) / L, ay + ((by - ay) * s) / L]);
    carry = L - (s - step);
  }
  const last = pts[pts.length - 1]!;
  const tail = out[out.length - 1]!;
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) < step * 0.5)
    out[out.length - 1] = last;
  else out.push(last);
  return out;
}

/**
 * Corners worn round: `passes` of neighbour averaging over an evenly sampled
 * line, point i never further than `maxDev[i]` px from where it was routed —
 * so a path bends freely across open ground and keeps to its routed line
 * where something stands close by. The ends stay put.
 */
export function fair(
  pts: readonly Pt[],
  maxDev: ArrayLike<number>,
  passes: number,
): Pt[] {
  const n = pts.length;
  if (n < 3) return [...pts];
  const ox = pts.map((p) => p[0]);
  const oy = pts.map((p) => p[1]);
  let x = [...ox];
  let y = [...oy];
  let nx = new Array<number>(n);
  let ny = new Array<number>(n);
  for (let k = 0; k < passes; k++) {
    nx[0] = x[0]!;
    ny[0] = y[0]!;
    nx[n - 1] = x[n - 1]!;
    ny[n - 1] = y[n - 1]!;
    for (let i = 1; i < n - 1; i++) {
      let qx = (x[i - 1]! + 2 * x[i]! + x[i + 1]!) / 4;
      let qy = (y[i - 1]! + 2 * y[i]! + y[i + 1]!) / 4;
      const dx = qx - ox[i]!;
      const dy = qy - oy[i]!;
      const d = Math.hypot(dx, dy);
      const cap = maxDev[i]!;
      if (d > cap) {
        qx = ox[i]! + (dx / d) * cap;
        qy = oy[i]! + (dy / d) * cap;
      }
      nx[i] = qx;
      ny[i] = qy;
    }
    [x, nx] = [nx, x];
    [y, ny] = [ny, y];
  }
  return x.map((v, i): Pt => [v, y[i]!]);
}

/**
 * A gentle wander: each point pushed by slow fields of the place it is at — so
 * two roads sharing a stretch wander together — a long sway of up to `amp[i]`
 * px and a short one a quarter of that, fading to nothing over `taper` px at
 * both ends.
 */
export function meander(
  pts: readonly Pt[],
  amp: ArrayLike<number>,
  taper = 60,
): Pt[] {
  const n = pts.length;
  if (n < 3) return [...pts];
  const arc = [0];
  for (let i = 1; i < n; i++)
    arc.push(
      arc[i - 1]! +
        Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]),
    );
  const L = arc[n - 1]!;
  return pts.map(([px, py], i): Pt => {
    const e = smoothstep(0, taper, Math.min(arc[i]!, L - arc[i]!)) * amp[i]!;
    if (e <= 0) return [px, py];
    return [
      px +
        ((vnoise(px / 210 + 41.3, py / 210 + 7.7) - 0.5) * 2 +
          (vnoise(px / 70 + 11.9, py / 70 + 83.1) - 0.5) * 0.5) *
          e,
      py +
        ((vnoise(px / 210 + 3.1, py / 210 + 59.9) - 0.5) * 2 +
          (vnoise(px / 70 + 27.5, py / 70 + 5.3) - 0.5) * 0.5) *
          e,
    ];
  });
}

/** The roads laid so far, as points: "what runs near here, where exactly, and which road is it?" */
export interface PathNet {
  /** Lays a road; `tag` names it (what `nearest` answers). */
  add(pts: readonly Pt[], tag?: number): void;
  /** A laid point within 7 px of the search-grid cell at (x, y) — the first laid there — or null. */
  at(x: number, y: number): Pt | null;
  /** The nearest laid point within `r` px of (x, y), or null. */
  nearest(
    x: number,
    y: number,
    r: number,
  ): { x: number; y: number; d: number; tag: number } | null;
}

export function pathNet(cell = 40): PathNet {
  const m = new Map<number, number[]>();
  const onGrid = new Map<number, Pt>();
  const key = (i: number, j: number) => (i * 73856093) ^ (j * 19349663);
  return {
    add(pts, tag = -1) {
      for (const [x, y] of resampled(pts, 6)) {
        const k = key(Math.floor(x / cell), Math.floor(y / cell));
        let a = m.get(k);
        if (!a) m.set(k, (a = []));
        a.push(x, y, tag);
        // the search grid's cells this point lies in or beside
        const gi = Math.round(x / STEP);
        const gj = Math.round(y / STEP);
        for (let di = -1; di <= 1; di++)
          for (let dj = -1; dj <= 1; dj++) {
            const gx = (gi + di) * STEP;
            const gy = (gj + dj) * STEP;
            if ((gx - x) ** 2 + (gy - y) ** 2 < 49) {
              const gk = cellKey(gi + di, gj + dj);
              if (!onGrid.has(gk)) onGrid.set(gk, [x, y]);
            }
          }
      }
    },
    at(x, y) {
      return (
        onGrid.get(cellKey(Math.round(x / STEP), Math.round(y / STEP))) ?? null
      );
    },
    nearest(x, y, r) {
      let best = r * r;
      let bx = 0;
      let by = 0;
      let bt = -1;
      let hit = false;
      for (
        let i = Math.floor((x - r) / cell);
        i <= Math.floor((x + r) / cell);
        i++
      )
        for (
          let j = Math.floor((y - r) / cell);
          j <= Math.floor((y + r) / cell);
          j++
        ) {
          const a = m.get(key(i, j));
          if (!a) continue;
          for (let k = 0; k < a.length; k += 3) {
            const dx = a[k]! - x;
            const dy = a[k + 1]! - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < best) {
              best = d2;
              bx = a[k]!;
              by = a[k + 1]!;
              bt = a[k + 2]!;
              hit = true;
            }
          }
        }
      return hit ? { x: bx, y: by, d: Math.sqrt(best), tag: bt } : null;
    },
  };
}

/** How near (px) a path must run beside a laid road to be drawn into it. */
const MERGE_REACH = 38;

/**
 * A path running close beside a road already laid is drawn into it — two
 * ribbons side by side become one trodden way. Its first `free` px (the door's
 * own approach) are left alone.
 */
export function drawnInto(
  pts: readonly Pt[],
  net: PathNet,
  free: number,
): Pt[] {
  let arc = 0;
  return pts.map(([x, y], i): Pt => {
    if (i > 0) arc += Math.hypot(x - pts[i - 1]![0], y - pts[i - 1]![1]);
    if (i === 0 || i === pts.length - 1 || arc < free) return [x, y];
    const q = net.nearest(x, y, MERGE_REACH);
    if (!q) return [x, y];
    const w =
      (1 - smoothstep(10, MERGE_REACH, q.d)) *
      (free > 0 ? smoothstep(free, free + 40, arc) : 1) *
      0.9;
    return [x + (q.x - x) * w, y + (q.y - y) * w];
  });
}

/** Boxes, for "how far is the nearest one from here?" (up to `reach` px). */
export interface BoxField {
  /** The distance from (x, y) to the nearest box, `reach` when none is that near; `skip` is left out. */
  dist(x: number, y: number, skip?: number): number;
  /** Which box comes within `r` px of (x, y): its index, -1 for none, -2 for more than one. */
  within(x: number, y: number, r: number): number;
}

type Rect = readonly [number, number, number, number];

export function boxField(boxes: readonly Rect[], reach: number): BoxField {
  const cell = 256;
  const m = new Map<number, number[]>();
  const key = (i: number, j: number) => (i * 73856093) ^ (j * 19349663);
  boxes.forEach((b, n) => {
    for (
      let i = Math.floor((b[0] - reach) / cell);
      i <= Math.floor((b[2] + reach) / cell);
      i++
    )
      for (
        let j = Math.floor((b[1] - reach) / cell);
        j <= Math.floor((b[3] + reach) / cell);
        j++
      ) {
        const k = key(i, j);
        let a = m.get(k);
        if (!a) m.set(k, (a = []));
        a.push(n);
      }
  });
  return {
    dist(x, y, skip = -1) {
      let best = reach;
      const a = m.get(key(Math.floor(x / cell), Math.floor(y / cell)));
      if (a)
        for (const n of a) {
          if (n === skip) continue;
          const b = boxes[n]!;
          const dx = x < b[0] ? b[0] - x : x > b[2] ? x - b[2] : 0;
          const dy = y < b[1] ? b[1] - y : y > b[3] ? y - b[3] : 0;
          const d = Math.hypot(dx, dy);
          if (d < best) best = d;
        }
      return best;
    },
    within(x, y, r) {
      let hit = -1;
      const a = m.get(key(Math.floor(x / cell), Math.floor(y / cell)));
      if (a)
        for (const n of a) {
          const b = boxes[n]!;
          const dx = x < b[0] ? b[0] - x : x > b[2] ? x - b[2] : 0;
          const dy = y < b[1] ? b[1] - y : y > b[3] ? y - b[3] : 0;
          if (dx * dx + dy * dy < r * r) {
            if (hit >= 0 && hit !== n) return -2;
            hit = n;
          }
        }
      return hit;
    },
  };
}

let cells0: {
  n: number;
  gen: number;
  seen: Int32Array;
  dist: Float64Array;
  prev: Int32Array;
  state: Int8Array;
} | null = null;

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

/**
 * The cheapest way from `start` over free ground to the nearest goal: Dijkstra
 * on an 8 px grid (no cutting a blocked corner), out to `reach` px, then pulled
 * taut — every stretch of it a straight line over free ground. `goal` answers
 * the point a cell's way ends at (the road it meets), or null. → the way, from
 * `start` to that point, or null when no goal is within reach.
 */
export function cheapestWay(
  start: Pt,
  free: (x: number, y: number) => boolean,
  goal: (x: number, y: number) => Pt | null,
  reach: number,
): Pt[] | null {
  const n = Math.ceil(reach / STEP);
  const W = 2 * n + 1;
  const i0 = Math.round(start[0] / STEP) - n;
  const j0 = Math.round(start[1] / STEP) - n;
  // the search's cells, kept between searches: a cell is this search's once touched
  if (!cells0 || cells0.n < W * W)
    cells0 = {
      n: W * W,
      gen: 0,
      seen: new Int32Array(W * W),
      dist: new Float64Array(W * W),
      prev: new Int32Array(W * W),
      state: new Int8Array(W * W),
    };
  const { seen, dist, prev, state } = cells0;
  const gen = ++cells0.gen;
  const touch = (c: number) => {
    if (seen[c] !== gen) {
      seen[c] = gen;
      dist[c] = Infinity;
      prev[c] = -1;
      state[c] = 0; // 0 unknown, 1 free, 2 blocked
    }
  };
  const isFree = (c: number): boolean => {
    touch(c);
    if (state[c] === 0) {
      const x = (i0 + (c % W)) * STEP;
      const y = (j0 + ((c / W) | 0)) * STEP;
      state[c] = free(x, y) ? 1 : 2;
    }
    return state[c] === 1;
  };
  // a binary heap of (distance, cell)
  const hd: number[] = [];
  const hc: number[] = [];
  const push = (d: number, c: number) => {
    let i = hd.length;
    hd.push(d);
    hc.push(c);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p]! <= d) break;
      hd[i] = hd[p]!;
      hc[i] = hc[p]!;
      i = p;
    }
    hd[i] = d;
    hc[i] = c;
  };
  const pop = (): number => {
    const top = hc[0]!;
    const d = hd.pop()!;
    const c = hc.pop()!;
    const len = hd.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        let k = 2 * i + 1;
        if (k >= len) break;
        if (k + 1 < len && hd[k + 1]! < hd[k]!) k++;
        if (hd[k]! >= d) break;
        hd[i] = hd[k]!;
        hc[i] = hc[k]!;
        i = k;
      }
      hd[i] = d;
      hc[i] = c;
    }
    return top;
  };
  const s = n * W + n;
  touch(s);
  dist[s] = 0;
  state[s] = 1; // the door itself
  push(0, s);
  let end = -1;
  let endPt: Pt | null = null;
  while (hd.length) {
    const d = hd[0]!;
    const c = pop();
    if (d > dist[c]!) continue;
    const ci = c % W;
    const cj = (c / W) | 0;
    const g = goal((i0 + ci) * STEP, (j0 + cj) * STEP);
    if (g) {
      end = c;
      endPt = g;
      break;
    }
    for (const [di, dj, w] of DIRS) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= W) continue;
      const q = nj * W + ni;
      const nd = d + w * STEP;
      if (nd > reach || !isFree(q) || nd >= dist[q]!) continue;
      if (
        di !== 0 &&
        dj !== 0 &&
        (!isFree(cj * W + ni) || !isFree(nj * W + ci))
      )
        continue;
      dist[q] = nd;
      prev[q] = c;
      push(nd, q);
    }
  }
  if (end < 0 || !endPt) return null;
  const cells: Pt[] = [];
  for (let c = end; c >= 0; c = prev[c]!)
    cells.push([(i0 + (c % W)) * STEP, (j0 + ((c / W) | 0)) * STEP]);
  cells.reverse();
  cells[0] = start;
  cells.push(endPt);
  // pulled taut: from each kept point, straight to the furthest it can see
  const sees = (a: Pt, b: Pt): boolean => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 4; t < L - 2; t += 4)
      if (!free(a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L))
        return false;
    return true;
  };
  const out: Pt[] = [cells[0]!];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && !sees(cells[i]!, cells[j]!)) j--;
    out.push(cells[j]!);
    i = j;
  }
  return out;
}
