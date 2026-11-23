// What is painted onto a tile from the layout: roads (plain worn earth, soft
// verges, grit, grass creeping in, stones), bridges (planks over the water),
// district squares (rings of old flagstones), empty lots (a fenced patch with
// a blank stake), and the signposts drawn over everything.

import type { Box } from "@plugins/apps/plugins/isle/plugins/buildings/core";
import {
  hash,
  roadHash,
  vnoise,
  type Plot,
  type Road,
  type Square,
} from "@plugins/apps/plugins/isle/plugins/world/core";
import { INK, blob, ring, seeded, ss, stone, strHash, type Ctx } from "./kit";

const inBox =
  (bx0: number, by0: number, bx1: number, by1: number) =>
  (s: { x: number; y: number }, m: number) =>
    s.x > bx0 - m && s.x < bx1 + m && s.y > by0 - m && s.y < by1 + m;

const visibleRoads = (
  roads: readonly Road[],
  bx0: number,
  by0: number,
  bx1: number,
  by1: number,
) =>
  roads.filter(
    (r) =>
      !(
        r.bbox[2] < bx0 ||
        r.bbox[0] > bx1 ||
        r.bbox[3] < by0 ||
        r.bbox[1] > by1
      ),
  );

const ROAD_EARTH = "#c7b58b";
const TUFT_DARK = "rgba(60,74,38,.62)";
const TUFT_LITE = "rgba(150,158,92,.62)";

/** Three blades of grass at (x, y), added to a path. */
function tuft(P: Path2D, x: number, y: number, a: number, b: number): void {
  for (let q = -1; q <= 1; q++) {
    P.moveTo(x + q, y);
    P.lineTo(
      x + q * 2.2 + (hash(a + q, b) - 0.5) * 2,
      y - 3.5 - hash(q + 2, a) * 3,
    );
  }
}

/**
 * Roads: plain worn earth — one even wash with a soft verge and a faint pooled
 * edge, round blots of lighter and darker earth, grit, grass biting into the
 * edges, tufts along the verges and down a cart road's crown, small stones;
 * a little-used path half grown over; on a cart road the odd puddle. Nothing
 * runs along the road (no centre line, no ruts).
 */
export function paintRoads(
  g: Ctx,
  roads: readonly Road[],
  bx0: number,
  by0: number,
  bx1: number,
  by1: number,
): void {
  const inB = inBox(bx0, by0, bx1, by1);
  const vis = visibleRoads(roads, bx0, by0, bx1, by1).map((r) => ({
    r,
    h: roadHash(r.key),
  }));
  if (!vis.length) return;
  // every road's samples as one shape (a single fill: an even wash, no banding where samples overlap or roads meet)
  const body = (grow: number, wob: number) => {
    const P = new Path2D();
    for (const { r, h } of vis)
      r.samples.forEach((s, i) => {
        if (s.bridge || !inB(s, 52)) return;
        const rr = s.r + grow + (wob ? (hash(i, h + 31) - 0.5) * wob : 0);
        P.moveTo(s.x + rr, s.y);
        P.ellipse(s.x, s.y, rr, rr * 0.85, 0, 0, 6.2832);
      });
    return P;
  };
  g.fillStyle = "rgba(156,146,92,.2)";
  g.fill(body(9, 7));
  g.fillStyle = "rgba(150,134,88,.3)";
  g.fill(body(4, 4));
  g.fillStyle = "rgba(110,94,62,.2)";
  g.fill(body(1.6, 0));
  const B = body(0, 0);
  g.fillStyle = ROAD_EARTH;
  g.fill(B);
  g.save();
  g.clip(B);
  // a little-used path is half grown over: the turf's green washed back into it
  for (const [lo, hi, a] of [
    [0, 0.62, 0.3],
    [0.62, 0.8, 0.15],
  ] as const) {
    const P = new Path2D();
    let any = false;
    for (const { r } of vis) {
      if (r.wear < lo || r.wear >= hi) continue;
      for (let i = 0; i < r.samples.length; i += 2) {
        const s = r.samples[i]!;
        if (s.bridge || !inB(s, 40)) continue;
        P.moveTo(s.x + s.r + 3, s.y);
        P.arc(s.x, s.y, s.r + 3, 0, 6.2832);
        any = true;
      }
    }
    if (any) {
      g.fillStyle = `rgba(126,136,78,${a})`;
      g.fill(P);
    }
  }
  g.lineCap = "round";
  for (const { r, h } of vis) {
    const L = r.samples;
    if (r.kind === "trunk" || r.kind === "street") {
      // the odd puddle where the road dips
      for (let i = 0; i < L.length; i += 9) {
        const s = L[i]!;
        if (s.bridge || s.r < 15 || !inB(s, 14) || hash(i, h + 95) > 0.045)
          continue;
        const o = (hash(i, h + 96) - 0.5) * s.r * 0.9;
        const x = s.x - s.uy * o;
        const y = s.y + s.ux * o * 0.85;
        const rx = 4 + hash(i, h + 97) * 5.5;
        const rot = Math.atan2(s.uy, s.ux) + (hash(i, h + 98) - 0.5);
        g.fillStyle = "rgba(92,108,116,.6)";
        g.beginPath();
        g.ellipse(x, y, rx, rx * 0.55, rot, 0, 7);
        g.fill();
        g.strokeStyle = "rgba(74,60,40,.4)";
        g.lineWidth = 0.8;
        g.stroke();
        g.strokeStyle = "rgba(232,240,238,.55)";
        g.beginPath();
        g.ellipse(x, y, rx * 0.62, rx * 0.3, rot, 3.4, 4.9);
        g.stroke();
      }
    }
    // washes of lighter and darker earth (round blots: nothing runs along the road)
    for (let i = 0; i < L.length; i += 3) {
      const s = L[i]!;
      if (s.bridge || !inB(s, 30)) continue;
      const h1 = hash(i, h + 41);
      const o = (hash(i, h + 42) - 0.5) * s.r * 1.6;
      g.fillStyle = h1 < 0.5 ? "rgba(232,218,176,.17)" : "rgba(118,98,64,.1)";
      g.beginPath();
      g.ellipse(
        s.x - s.uy * o,
        s.y + s.ux * o,
        5 + h1 * 7,
        4 + hash(i, h + 43) * 5,
        hash(i, h + 44) * 3.1,
        0,
        7,
      );
      g.fill();
    }
    // grass biting into the edges
    for (let i = 0; i < L.length; i += 2) {
      const s = L[i]!;
      if (s.bridge || !inB(s, 16)) continue;
      const h1 = hash(i, h + 61);
      if (h1 > 0.42) continue;
      const side = hash(i, h + 62) < 0.5 ? -1 : 1;
      const o = side * (s.r * (0.93 + hash(i, h + 63) * 0.2));
      g.fillStyle = h1 < 0.2 ? "rgba(122,134,74,.8)" : "rgba(140,148,84,.7)";
      g.beginPath();
      g.ellipse(
        s.x - s.uy * o,
        s.y + s.ux * o * 0.85,
        3 + hash(i, h + 64) * 6,
        2 + hash(i, h + 65) * 3.5,
        Math.atan2(s.uy, s.ux),
        0,
        7,
      );
      g.fill();
    }
    // grit
    L.forEach((s, i) => {
      if (s.bridge || !inB(s, 6)) return;
      for (let q = 0; q < 2; q++) {
        const o = (hash(i, h + 71 + q) - 0.5) * s.r * 1.8;
        const a = (hash(i, h + 73 + q) - 0.5) * 4;
        g.fillStyle =
          hash(i, h + 75 + q) < 0.55
            ? "rgba(70,56,36,.3)"
            : "rgba(246,238,208,.34)";
        g.fillRect(s.x - s.uy * o + s.ux * a, s.y + s.ux * o + s.uy * a, 1, 1);
      }
    });
  }
  g.restore();
  g.lineCap = "round";
  for (const { r, h } of vis) {
    const L = r.samples;
    const cart = r.kind !== "spur" && r.kind !== "lane";
    // tufts along the verges and, on a cart road, down its crown
    const dark = new Path2D();
    const lite = new Path2D();
    L.forEach((s, i) => {
      if (s.bridge || !inB(s, 12)) return;
      for (let k = 0; k < 2; k++) {
        if (hash(i * 2 + k, h + 7) > 0.5) continue;
        const o = (k ? -1 : 1) * (s.r * 0.9 + hash(i, k + h) * 7 - 2);
        tuft(
          hash(i, h + 81 + k) < 0.55 ? dark : lite,
          s.x - s.uy * o,
          s.y + s.ux * o * 0.85,
          i,
          k + h,
        );
      }
      if (cart && hash(i, h + 85) < 0.1)
        tuft(
          hash(i, h + 88) < 0.5 ? dark : lite,
          s.x + (hash(i, h + 86) - 0.5) * 4,
          s.y + (hash(i, h + 87) - 0.5) * 3,
          i,
          h,
        );
    });
    g.lineWidth = 0.95;
    g.strokeStyle = TUFT_DARK;
    g.stroke(dark);
    g.strokeStyle = TUFT_LITE;
    g.stroke(lite);
    for (let i = 0; i < L.length; i += 3) {
      const s = L[i]!;
      if (s.bridge || !inB(s, 10) || hash(i, h + 3) > 0.3) continue;
      const o = (hash(i, h + 4) - 0.5) * s.r * 1.9;
      const t = hash(i, h + 6);
      const h5 = hash(i, h + 5);
      stone(
        g,
        s.x - s.uy * o,
        s.y + s.ux * o * 0.85,
        1.3 + h5 * h5 * 3.6,
        t,
        t * 3,
      );
    }
  }
}

/** Bridges: weathered planks, piles where they meet the bank, a rope rail. → whether any was drawn. */
export function paintBridges(
  g: Ctx,
  roads: readonly Road[],
  bx0: number,
  by0: number,
  bx1: number,
  by1: number,
): boolean {
  const inB = inBox(bx0, by0, bx1, by1);
  let any = false;
  for (const r of visibleRoads(roads, bx0, by0, bx1, by1)) {
    const h = roadHash(r.key);
    const list = r.samples;
    for (let i = 0; i < list.length; i += 2) {
      const s = list[i]!;
      if (!s.bridge || !inB(s, 40)) continue;
      const t = hash(i, h + 11);
      const bw = r.kind === "link" ? 22 : 20;
      g.save();
      g.translate(s.x, s.y);
      g.rotate(Math.atan2(s.uy, s.ux));
      g.fillStyle = "rgba(20,40,55,.3)";
      g.fillRect(-4, bw - 2, 9, 10);
      g.fillStyle = `rgb(${(118 + t * 30) | 0},${(100 + t * 24) | 0},${(76 + t * 18) | 0})`;
      g.fillRect(-4, -bw, 8, bw * 2);
      g.strokeStyle = INK;
      g.lineWidth = 0.9;
      g.strokeRect(-4, -bw, 8, bw * 2);
      const prev = list[Math.max(0, i - 2)]!;
      const nxt = list[Math.min(list.length - 1, i + 2)]!;
      if (prev.bridge !== nxt.bridge || hash(i, h + 12) < 0.07) {
        g.fillStyle = "#4e3e2c";
        g.fillRect(-2, -bw - 10, 5, 12);
        g.fillRect(-2, bw - 2, 5, 12);
        g.strokeStyle = INK;
        g.strokeRect(-2, -bw - 10, 5, 12);
        g.strokeRect(-2, bw - 2, 5, 12);
      }
      g.strokeStyle = "rgba(86,70,50,.9)";
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(-4, -bw - 4);
      g.lineTo(5, -bw - 4);
      g.moveTo(-4, bw + 4);
      g.lineTo(5, bw + 4);
      g.stroke();
      g.restore();
      any = true;
    }
  }
  return any;
}

/** A square's outline, a wobbly ring → that ring grown by some px. */
function squareRing(q: Square): (grow: number) => Path2D {
  const rnd = seeded(strHash(`sqr:${q.key}`));
  const n = 18;
  const f = Array.from({ length: n }, () => 0.94 + rnd() * 0.12);
  return (grow) =>
    ring(
      f.map((k, i) => {
        const a = (i / n) * 6.2832;
        return [
          q.x + Math.cos(a) * (q.r * k + grow),
          q.y + Math.sin(a) * (q.r * k + grow) * 0.92,
        ] as const;
      }),
    );
}

/** A square's worn verge: painted under the roads, so a road runs into the square without an edge across it. */
export function paintSquareVerge(g: Ctx, q: Square): void {
  const at = squareRing(q);
  g.fillStyle = "rgba(156,146,92,.2)";
  g.fill(at(15));
  g.fillStyle = "rgba(150,134,88,.3)";
  g.fill(at(7));
  g.fillStyle = "rgba(110,94,62,.2)";
  g.fill(at(1.6));
}

/**
 * A district square: packed earth, and rings of old flagstones laid round its
 * middle (round the fire, where it burns), breaking up toward the edge —
 * moss, cracks, tufts between them, a few loose stones.
 */
export function paintSquare(g: Ctx, q: Square): void {
  const rnd = seeded(strHash(`sq:${q.key}`));
  const body = squareRing(q)(0);
  const SQ = 0.74;
  g.fillStyle = ROAD_EARTH;
  g.fill(body);
  g.save();
  g.clip(body);
  for (let i = 0; i < 60 * (q.r / 140) ** 2; i++) {
    const a = rnd() * 7;
    const d = Math.sqrt(rnd()) * q.r;
    g.fillStyle = rnd() < 0.5 ? "rgba(232,218,176,.2)" : "rgba(118,98,64,.13)";
    g.beginPath();
    g.ellipse(
      q.x + Math.cos(a) * d,
      q.y + Math.sin(a) * d * 0.92,
      8 + rnd() * 16,
      4 + rnd() * 9,
      rnd() * 3,
      0,
      7,
    );
    g.fill();
  }
  for (let i = 0; i < 26; i++) {
    const a = rnd() * 7;
    const k = 0.95 + rnd() * 0.1;
    g.fillStyle = rnd() < 0.5 ? "rgba(122,134,74,.8)" : "rgba(140,148,84,.7)";
    g.beginPath();
    g.ellipse(
      q.x + Math.cos(a) * q.r * k,
      q.y + Math.sin(a) * q.r * k * 0.92,
      4 + rnd() * 8,
      2.5 + rnd() * 4,
      a + 1.57,
      0,
      7,
    );
    g.fill();
  }
  // the bedding the stones lie in
  g.fillStyle = "rgba(104,88,60,.2)";
  g.beginPath();
  g.ellipse(q.x, q.y, q.r * 0.7, q.r * 0.7 * SQ, 0, 0, 7);
  g.fill();
  if (q.camp) {
    const gr = g.createRadialGradient(q.x, q.y, 6, q.x, q.y, 46);
    gr.addColorStop(0, "rgba(58,48,36,.42)");
    gr.addColorStop(1, "rgba(58,48,36,0)");
    g.fillStyle = gr;
    g.fillRect(q.x - 50, q.y - 50, 100, 100);
  }
  const step = 15.5;
  const tufts: [number, number][] = [];
  for (let rr = q.camp ? 38 : 12; rr < q.r * 0.93; rr += step) {
    let a = rnd() * 6.2832;
    const end = a + 6.2832;
    while (a < end - 0.02) {
      const wdt = 15 + rnd() * 15;
      const da = Math.min(end - a, wdt / rr);
      const am = a + da / 2;
      const f = rr / q.r;
      const x = q.x + Math.cos(am) * (rr + step / 2);
      const y = q.y + Math.sin(am) * (rr + step / 2) * SQ;
      const keep =
        (1 - ss(0.42, 0.92, f + (vnoise(x / 34 + 7, y / 34) - 0.5) * 0.5)) *
        (vnoise(x / 50 + 91, y / 50 + 3) > 0.3 ? 1 : 0.2);
      const u = rnd();
      const v0 = rnd();
      const c1 = rnd();
      const c2 = rnd();
      const c3 = rnd();
      const c4 = rnd();
      const mo = rnd();
      const cr = rnd();
      if (u < keep) {
        const gp = 1.1 / rr;
        const at = (ang: number, rad: number, j: number) =>
          [
            q.x + Math.cos(ang) * rad + (j - 0.5) * 2.2,
            q.y + Math.sin(ang) * rad * SQ + (j - 0.5) * 1.6,
          ] as const;
        const jr = (c3 - 0.5) * 3.4;
        const i0 = rr + 1 + c1 * 1.8 + jr;
        const o0 = rr + step - 1 - c2 * 1.8 + jr;
        const p1 = at(am, i0 - 0.4, c3);
        const p4 = at(am, o0 + 0.6, c4);
        const p5 = at(a + gp, o0, c4);
        const pts = [
          at(a + gp, i0, c1),
          p1,
          at(a + da - gp, i0, c2),
          at(a + da - gp, o0, c3),
          p4,
          p5,
        ];
        const path = new Path2D();
        pts.forEach(([px, py], i) =>
          i ? path.lineTo(px, py) : path.moveTo(px, py),
        );
        path.closePath();
        g.fillStyle = "rgba(48,40,28,.3)";
        g.save();
        g.translate(1, 1.3);
        g.fill(path);
        g.restore();
        const v = 0.84 + v0 * 0.22;
        const warm = c4 < 0.35 ? 12 : 0;
        g.fillStyle = `rgb(${((178 + warm) * v) | 0},${((168 + warm * 0.4) * v) | 0},${(146 * v) | 0})`;
        g.lineJoin = "round";
        g.fill(path);
        g.save();
        g.clip(path);
        g.fillStyle = "rgba(255,250,232,.2)";
        g.beginPath();
        g.ellipse(x - wdt * 0.25, y - 4, wdt * 0.45, 4, 0, 0, 7);
        g.fill();
        g.fillStyle = "rgba(60,50,36,.16)";
        g.beginPath();
        g.ellipse(x + wdt * 0.3, y + 4, wdt * 0.5, 4, 0, 0, 7);
        g.fill();
        const sd = (v0 * 1e4) | 0;
        for (let k = 0; k < 5; k++) {
          g.fillStyle = k % 2 ? "rgba(50,42,30,.25)" : "rgba(255,250,235,.3)";
          g.fillRect(
            x + (hash(k, sd) - 0.5) * wdt * 0.8,
            y + (hash(k + 9, sd) - 0.5) * step * 0.6,
            1,
            1,
          );
        }
        g.restore();
        g.strokeStyle = "rgba(52,42,30,.62)";
        g.lineWidth = 0.85;
        g.stroke(path);
        if (cr < 0.14) {
          g.strokeStyle = "rgba(52,42,30,.5)";
          g.lineWidth = 0.7;
          g.beginPath();
          g.moveTo(p1[0], p1[1]);
          g.lineTo(x + (c1 - 0.5) * 4, y + (c2 - 0.5) * 2);
          g.lineTo(p4[0] + (c3 - 0.5) * 6, p4[1]);
          g.stroke();
        }
        if (mo < 0.22) {
          g.fillStyle = "rgba(98,112,60,.75)";
          for (let k = 0; k < 4; k++) {
            g.beginPath();
            g.arc(
              p5[0] + hash(k, 3) * 5,
              p5[1] - hash(k, 4) * 3,
              0.9 + hash(k, 5) * 1.2,
              0,
              7,
            );
            g.fill();
          }
        }
      } else if (u < keep + 0.3 && f > 0.45) tufts.push([x, y]);
      a += da;
    }
  }
  g.restore();
  const dark = new Path2D();
  const lite = new Path2D();
  tufts.forEach(([x, y], i) => tuft(i % 2 ? dark : lite, x, y, i, 5));
  for (let i = 0; i < 40; i++) {
    const a = rnd() * 7;
    const k = 0.9 + rnd() * 0.16;
    tuft(
      i % 2 ? dark : lite,
      q.x + Math.cos(a) * q.r * k,
      q.y + Math.sin(a) * q.r * k * 0.92,
      i,
      11,
    );
  }
  g.lineWidth = 0.95;
  g.lineCap = "round";
  g.strokeStyle = TUFT_DARK;
  g.stroke(dark);
  g.strokeStyle = TUFT_LITE;
  g.stroke(lite);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * 7;
    const d = (0.3 + rnd() * 0.65) * q.r;
    const t = rnd();
    const sz = rnd();
    stone(
      g,
      q.x + Math.cos(a) * d,
      q.y + Math.sin(a) * d * 0.9,
      1.4 + sz * sz * 3,
      t,
      t * 3,
    );
  }
}

/**
 * An empty lot's fenced patch, world px: what is painted, and what the hero
 * stands on or a click lands on to give it back to nature.
 */
export function lotPatch(p: Plot): Box {
  const w = (p.g[2] - p.g[0]) * 0.72;
  return [p.x - w / 2, p.y - 70, p.x + w / 2, p.y + 4];
}

/** An empty lot: a fenced patch of turned earth with weeds and a bare stake — room for the next app. */
export function paintLot(g: Ctx, p: Plot): void {
  const rnd = seeded(strHash(`lot:${p.id}`));
  const [x0, y0, x1, y1] = lotPatch(p);
  const w = x1 - x0;
  g.fillStyle = "rgba(120,100,64,.32)";
  blob(g, p.x, (y0 + y1) / 2, w * 0.52, rnd, 12, 0.18);
  g.fill();
  for (let i = 0; i < 26; i++) {
    const x = x0 + rnd() * w;
    const y = y0 + rnd() * (y1 - y0);
    g.strokeStyle = rnd() < 0.5 ? "rgba(70,82,40,.65)" : "rgba(150,150,90,.6)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 4, y - 4 - rnd() * 5);
    g.stroke();
  }
  const post = (x: number, y: number) => {
    g.fillStyle = "#6d5638";
    g.fillRect(x - 2, y - 14, 4, 14);
    g.strokeStyle = INK;
    g.lineWidth = 0.8;
    g.strokeRect(x - 2, y - 14, 4, 14);
  };
  const rail = (ax: number, ay: number, bx: number, by: number) => {
    g.strokeStyle = "rgba(122,100,70,.95)";
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(ax, ay - 10);
    g.lineTo(bx, by - 10);
    g.moveTo(ax, ay - 5);
    g.lineTo(bx, by - 5);
    g.stroke();
  };
  const n = Math.max(2, Math.round(w / 34));
  for (let i = 0; i <= n; i++) {
    const x = x0 + (w * i) / n;
    if (i < n && rnd() > 0.2) rail(x, y0, x0 + (w * (i + 1)) / n, y0);
    post(x, y0);
  }
  for (const x of [x0, x1]) {
    if (rnd() > 0.25) rail(x, y0, x, y1 - 14);
    post(x, (y0 + y1 - 14) / 2);
    post(x, y1 - 14);
  }
  g.fillStyle = "#7b6549";
  g.fillRect(p.x + w * 0.22 - 1.5, y1 - 34, 3, 30);
  g.fillStyle = "#e8dcc0";
  g.beginPath();
  g.roundRect(p.x + w * 0.22 - 9, y1 - 40, 18, 11, 2);
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 0.9;
  g.stroke();
}

export const SIGN_FONT = "800 14px Nunito, sans-serif";

/** A building's signpost as the sign painter sees it. */
export interface SignInfo {
  readonly x: number;
  readonly y: number;
  readonly name: string;
  /** Half the board's width + 4 (placement's `signHalfWidth`). */
  readonly signHalf: number;
  /** The icon tile's colour. */
  readonly tile: string;
  /** The app's glyph, white, square. */
  readonly glyph: CanvasImageSource;
  /**
   * The time of day's light on the sign, multiplied over post and board (null by day): signs are drawn
   * above the scene's own tint so they stay readable, so they take a softer one of their own.
   */
  readonly light: string | null;
}

/** The sign's light per time of day: softer than the scene's tint, so the name still reads. */
export const SIGN_LIGHT = {
  day: null,
  dusk: "#f4d6bc",
  night: "#8794bd",
} as const;

/** The signpost; hover 0..1 lifts and brightens the board. The name is fitted to the board placement reserved. */
export function drawSign(g: Ctx, s: SignInfo, hover: number): void {
  g.save();
  g.translate(s.x, s.y);
  g.fillStyle = "rgba(30,30,20,.28)";
  g.beginPath();
  g.ellipse(5, 1, 12, 4, 0, 0, 7);
  g.fill();
  g.fillStyle = "#6d5638";
  g.fillRect(-2.5, -38, 5, 38);
  g.strokeStyle = INK;
  g.lineWidth = 1;
  g.strokeRect(-2.5, -38, 5, 38);
  g.font = SIGN_FONT;
  const bw = (s.signHalf - 4) * 2;
  const room = bw - 44;
  const tw = g.measureText(s.name).width;
  const bx = -bw / 2;
  const by = -68 - 3 * hover;
  g.fillStyle = "rgba(30,25,15,.3)";
  g.beginPath();
  g.roundRect(bx + 2, by + 3, bw, 30, 4);
  g.fill();
  g.fillStyle = "#5a4630";
  g.beginPath();
  g.roundRect(bx - 2, by - 2, bw + 4, 34, 5);
  g.fill();
  g.fillStyle = "#ece0c2";
  g.beginPath();
  g.roundRect(bx, by, bw, 30, 3.5);
  g.fill();
  if (hover > 0) {
    g.globalAlpha *= hover;
    g.fillStyle = "#f8f0dc";
    g.fill();
    g.globalAlpha /= hover;
  }
  g.fillStyle = "rgba(120,96,60,.14)";
  g.fillRect(bx + 2, by + 22, bw - 4, 6);
  g.fillStyle = s.tile;
  g.beginPath();
  g.roundRect(bx + 5, by + 4, 22, 22, 4);
  g.fill();
  g.drawImage(s.glyph, bx + 8, by + 7.5, 16, 16);
  g.fillStyle = "#2e2418";
  g.textAlign = "left";
  g.textBaseline = "middle";
  if (tw > room) {
    g.translate(bx + 33, by + 16);
    g.scale(room / tw, 1);
    g.fillText(s.name, 0, 0);
  } else g.fillText(s.name, bx + 33, by + 16);
  g.restore();
  if (s.light) {
    // the light falls on post and board alone; a hovered sign is lit a little, as by a lantern
    g.save();
    g.translate(s.x, s.y);
    g.globalCompositeOperation = "multiply";
    g.fillStyle = s.light;
    g.fillRect(-3, -38, 6, 39);
    g.beginPath();
    g.roundRect(bx - 2.5, by - 2.5, bw + 5, 35, 5);
    g.fill();
    if (hover > 0) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha *= 0.18 * hover;
      g.fillStyle = "#ffd9a0";
      g.fill();
    }
    g.restore();
  }
}

/**
 * An empty lot coming back to life — drawn over it while the mouse rests on
 * it (or the hero stands on it), saying a click (or E) gives it back to
 * nature: a green wash over the turned earth and shoots pushing up through
 * it, each in its own turn, swaying; the tallest open a flower. `grow` 0..1
 * (eased by the caller), `t` seconds (0: still).
 */
export function paintLotSprouts(
  g: Ctx,
  p: Plot,
  grow: number,
  t: number,
): void {
  const rnd = seeded(strHash(`sprouts:${p.id}`));
  const [x0, y0, x1, y1] = lotPatch(p);
  const w = x1 - x0;
  g.save();
  g.fillStyle = `rgba(118,170,72,${0.3 * grow})`;
  blob(g, p.x, (y0 + y1) / 2, w * 0.5 * (0.7 + 0.3 * grow), rnd, 12, 0.2);
  g.fill();
  const shoots = Array.from({ length: Math.max(9, Math.round(w / 9)) }, () => ({
    x: x0 + 6 + rnd() * (w - 12),
    y: y0 + 8 + rnd() * (y1 - y0 - 10),
    h: 9 + rnd() * 15,
    d: rnd(),
    ph: rnd() * 6.28,
    lean: (rnd() - 0.5) * 0.35,
    bloom: rnd() < 0.35 ? (rnd() < 0.5 ? "#f2d35b" : "#f4a3b4") : null,
  })).sort((a, b) => a.y - b.y);
  g.lineCap = "round";
  for (const s of shoots) {
    const k = Math.max(0, Math.min(1, (grow - 0.45 * s.d) / 0.55));
    if (k <= 0) continue;
    const h = s.h * k;
    const a = s.lean + Math.sin(t * 1.8 + s.ph) * 0.07 * k;
    const tx = s.x + Math.sin(a) * h;
    const ty = s.y - Math.cos(a) * h;
    g.strokeStyle = "#4f7a2c";
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(s.x, s.y);
    g.quadraticCurveTo(s.x + Math.sin(a) * h * 0.3, s.y - h * 0.6, tx, ty);
    g.stroke();
    const leaf = Math.max(0, (k - 0.3) / 0.7) * 5;
    if (leaf > 0.3) {
      const ly = s.y - h * 0.55;
      const lx = s.x + Math.sin(a) * h * 0.5;
      g.fillStyle = "#7cb342";
      g.strokeStyle = "rgba(40,60,25,.6)";
      g.lineWidth = 0.6;
      for (const dir of [-1, 1]) {
        g.beginPath();
        g.ellipse(
          lx + dir * leaf * 0.8,
          ly - leaf * 0.2,
          leaf,
          leaf * 0.45,
          dir * -0.5 + a,
          0,
          7,
        );
        g.fill();
        g.stroke();
      }
    }
    if (s.bloom && k > 0.85) {
      const r = ((k - 0.85) / 0.15) * 2.6;
      g.fillStyle = s.bloom;
      g.beginPath();
      g.arc(tx, ty, r, 0, 7);
      g.fill();
      g.fillStyle = "rgba(255,250,235,.9)";
      g.beginPath();
      g.arc(tx, ty, r * 0.35, 0, 7);
      g.fill();
    } else {
      g.fillStyle = "#8fc456";
      g.beginPath();
      g.arc(tx, ty, 1.4 * k, 0, 7);
      g.fill();
    }
  }
  g.restore();
}
