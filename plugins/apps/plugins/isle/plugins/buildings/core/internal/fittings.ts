// The fittings kit: what the folly buildings (a copper globe, a map-pin
// lighthouse, a pencil tower, a library of books) are fitted out with, beyond
// the main kit's stone, boards and slate — metalwork (bars of brass and timber
// stroked along a path, rivets, portholes), a round coursed drum, weather
// streaks, a slate boulder — and the small moving parts their `animate` draws:
// a gust curve, a cloth on a pole, a window breathing with lamp light, a line
// being written. The painters draw their randomness from the `rnd` they are
// handed, in a fixed order; the animation helpers take none.

import {
  SHADOW_ALPHA_MAX,
  type Box,
  type Ctx2D,
  type PaintState,
} from "../spec";
import { dark, jit, light, type Rnd } from "./colour";
import { bbox, castShadow, hline, ink, poly, wash, type Pt } from "./draw";
import { withinProjection } from "./projection-scope";

const TAU = Math.PI * 2;
const INK = "rgba(48,38,28,.85)";
const BRASS = "#a8874f";
const BRASS_D = "#6c5a3a";
const BRASS_L = "#cdb27c";
const GILT = "#b09a62";
const VERDIGRIS = "#6f9586";
const IRON = "#3f3c38";
/** Coursed stone, as the drum's `tone`: lit side, middle, shaded side, block. */
const STONE = ["#cfc8b7", "#b8b09e", "#77705f", "#b4ad9c"] as const;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** Smoothstep: 0..1 eased at both ends. */
const ease = (u: number): number => u * u * (3 - 2 * u);

/** Begins a full circle path. */
function disc(g: Ctx2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
}

/** Begins a one-segment path. */
function seg(g: Ctx2D, x0: number, y0: number, x1: number, y1: number): void {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
}

/** An elliptical shadow's fills: `[scale, strength]`, widest and faintest first. */
const ELL_SHADOW = [
  [1.16, 0.3],
  [1.07, 0.45],
  [1, 0.7],
] as const;

/** A soft elliptical ground shadow, `a` its strength — held under `SHADOW_ALPHA_MAX`. */
function ellShadow(
  g: Ctx2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  a: number,
): void {
  // its three fills add up in the middle: held under what one shadow may reach
  const peak = (s: number) =>
    1 - ELL_SHADOW.reduce((t, [, al]) => t * (1 - s * al), 1);
  while (peak(a) > SHADOW_ALPHA_MAX) a *= 0.97;
  for (const [k, al] of ELL_SHADOW) {
    g.fillStyle = `rgba(34,40,22,${a * al})`;
    g.beginPath();
    g.ellipse(x, y, rx * k, ry * k, 0, 0, TAU);
    g.fill();
  }
}

/** Strokes the current path as a solid bar of metal or wood: an ink edge, the body, a highlight. */
function bar(g: Ctx2D, w: number, col: string, hi: string | null): void {
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = "rgba(48,38,28,.88)";
  g.lineWidth = w + 2.2;
  g.stroke();
  g.strokeStyle = col;
  g.lineWidth = w;
  g.stroke();
  if (hi) {
    g.strokeStyle = hi;
    g.lineWidth = Math.max(0.8, w * 0.28);
    g.translate(-w * 0.18, -w * 0.18);
    g.stroke();
  }
  g.restore();
}

/** A rivet head at (x, y), `s` its scale. */
function rivet(g: Ctx2D, x: number, y: number, s: number): void {
  g.fillStyle = "rgba(30,26,20,.5)";
  g.fillRect(x - 0.3 * s, y - 0.3 * s, 1.7 * s, 1.7 * s);
  g.fillStyle = "rgba(255,244,214,.45)";
  g.fillRect(x - 0.6 * s, y - 0.6 * s, 1 * s, 1 * s);
}

/** `n` rain streaks and stains in `box` (clip first), of colour `col` ("r,g,b"), about `len` long. */
function streaks(
  g: Ctx2D,
  r: Rnd,
  box: Box,
  n: number,
  col: string,
  a: number,
  len: number,
): void {
  const [x0, y0, x1, y1] = box;
  for (let k = 0; k < n; k++) {
    g.strokeStyle = `rgba(${col},${a * (0.5 + r())})`;
    g.lineWidth = 1.5 + r() * 3.5;
    const x = x0 + r() * (x1 - x0);
    const y = y0 + r() * (y1 - y0) * 0.7;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 3, y + len * (0.4 + r()));
    g.stroke();
  }
}

/** A brass-rimmed round window with a cross bar, lit warm at night. */
function porthole(
  g: Ctx2D,
  x: number,
  y: number,
  r: number,
  lit: boolean,
): void {
  disc(g, x, y, r + 2.6);
  g.fillStyle = BRASS_D;
  g.fill();
  ink(g, 1.1);
  g.stroke();
  const gl = g.createLinearGradient(x - r, y - r, x + r, y + r);
  if (lit) {
    gl.addColorStop(0, "#ffe2a0");
    gl.addColorStop(1, "#e7a54e");
  } else {
    gl.addColorStop(0, "#7d8a8e");
    gl.addColorStop(0.5, "#4d585e");
    gl.addColorStop(1, "#353d42");
  }
  disc(g, x, y, r);
  g.fillStyle = gl;
  g.fill();
  ink(g, 0.9);
  g.stroke();
  g.strokeStyle = BRASS_D;
  g.lineWidth = 1.2;
  seg(g, x - r, y, x + r, y);
  g.stroke();
  seg(g, x, y - r, x, y + r);
  g.stroke();
  if (!lit) {
    g.strokeStyle = "rgba(220,230,230,.3)";
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(x, y, r * 0.62, 3.5, 4.5);
    g.stroke();
  }
}

interface DrumOptions {
  /** Radius at the bottom and at the top (battered when they differ). */
  rb: number;
  rt: number;
  /** The y of the bottom and of the top. */
  yb: number;
  yt: number;
  /** How flat the round reads: the vertical radius of its ellipses. */
  ey: number;
  /** Course height. */
  row: number;
  /** The angle between two vertical joints. */
  joint: number;
  /** The colour of its top face, or null when something stands on it. */
  top: string | null;
  /** Lit side, middle, shaded side, block colour. */
  tone: readonly [string, string, string, string];
}

/** A round drum of coursed masonry centred on x = 0, lit from the left. */
function drum(g: Ctx2D, r: Rnd, o: DrumOptions): void {
  const { rb, rt, yb, yt, ey, row, joint, top, tone } = o;
  const rx = (y: number) => rb + ((rt - rb) * (y - yb)) / (yt - yb);
  const body = () => {
    g.beginPath();
    g.moveTo(-rb, yb);
    g.lineTo(-rt, yt);
    g.lineTo(rt, yt);
    g.lineTo(rb, yb);
    g.ellipse(0, yb, rb, ey, 0, 0, Math.PI);
    g.closePath();
  };
  g.save();
  body();
  g.clip();
  const gr = g.createLinearGradient(-rb, 0, rb, 0);
  gr.addColorStop(0, tone[0]);
  gr.addColorStop(0.42, tone[1]);
  gr.addColorStop(1, tone[2]);
  g.fillStyle = gr;
  g.fillRect(-rb, yt - 2, 2 * rb, yb - yt + ey + 4);
  for (let y = yb + ey; y > yt - row; y -= row) {
    const R = rx(y);
    ink(g, 0.7, 0.4);
    g.beginPath();
    g.ellipse(0, y, R, ey, 0, 0.05, Math.PI - 0.05);
    g.stroke();
    for (
      let a = Math.round(y / row) % 2 ? 0.2 : 0.03;
      a < Math.PI;
      a += joint
    ) {
      const x = -Math.cos(a) * R;
      const yy = y + Math.sin(a) * ey;
      hline(g, x, yy, x, yy - row, r, 0.2);
    }
    for (let k = 0; k < 7; k++) {
      g.fillStyle = jit(tone[3], r, 44, 0.24);
      g.beginPath();
      g.ellipse(
        -R + r() * 2 * R,
        y + ey * 0.4 - r() * row,
        4 + r() * 4,
        3,
        0,
        0,
        TAU,
      );
      g.fill();
    }
  }
  streaks(g, r, [-rb, yt, rb, yb], 6, "70,64,52", 0.14, (yb - yt) * 0.6);
  const sh = g.createLinearGradient(0, yt, 0, yt + 26);
  sh.addColorStop(0, "rgba(30,26,20,.4)");
  sh.addColorStop(1, "rgba(30,26,20,0)");
  g.fillStyle = sh;
  g.fillRect(-rb, yt, 2 * rb, 26);
  const ao = g.createLinearGradient(0, yb - 8, 0, yb + ey);
  ao.addColorStop(0, "rgba(30,28,18,0)");
  ao.addColorStop(1, "rgba(30,28,18,.38)");
  g.fillStyle = ao;
  g.fillRect(-rb, yb - 8, 2 * rb, ey + 10);
  g.restore();
  body();
  ink(g, 1.5);
  g.stroke();
  if (top) {
    g.fillStyle = top;
    g.beginPath();
    g.ellipse(0, yt, rt, ey, 0, 0, TAU);
    g.fill();
    ink(g, 1.2);
    g.stroke();
  }
}

interface MetalOptions {
  /** The share of blots that are verdigris, and that are bare or rusted patches (of colour `bareCol`, "r,g,b"). */
  verd?: number;
  bare?: number;
  bareCol?: string;
  /** How dark the side away from the light gets (0..1). */
  shade?: number;
  /** The number of rain streaks (default: from the width). */
  streaks?: number;
  /** Outline width. */
  lw?: number;
  /** Seams, rivets and shading drawn inside the sheet's clip, before its outline. */
  inside?: () => void;
}

/**
 * A sheet-metal surface filling `path` (whose box is `box`): lit from the
 * left, mottled with patina and bare patches, rain-streaked, inked.
 */
function metal(
  g: Ctx2D,
  r: Rnd,
  path: () => void,
  box: Box,
  col: string,
  o: MetalOptions = {},
): void {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0;
  const h = y1 - y0;
  g.save();
  path();
  g.clip();
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, light(col, 0.2));
  gr.addColorStop(0.4, col);
  gr.addColorStop(1, dark(col, o.shade ?? 0.42));
  g.fillStyle = gr;
  g.fillRect(x0, y0, w, h);
  const n = Math.min(240, (w * h) / 110);
  const vd = o.verd ?? 0.16;
  const br = o.bare ?? 0.12;
  for (let i = 0; i < n; i++) {
    const k = r();
    g.fillStyle =
      k < vd
        ? `rgba(118,158,140,${0.16 + r() * 0.26})`
        : k < vd + br
          ? `rgba(${o.bareCol ?? "92,60,40"},${0.12 + r() * 0.2})`
          : jit(col, r, 38, 0.22);
    g.beginPath();
    g.ellipse(
      x0 + r() * w,
      y0 + r() * h,
      3 + r() * 10,
      2 + r() * 6,
      r() * 3,
      0,
      TAU,
    );
    g.fill();
  }
  const ns = o.streaks ?? w / 9;
  streaks(g, r, box, ns, "40,36,30", 0.13, h * 0.4);
  streaks(g, r, box, ns / 2, "206,226,208", 0.09, h * 0.3);
  o.inside?.();
  g.restore();
  path();
  ink(g, o.lw ?? 1.6);
  g.stroke();
}

/** Begins the near half of a ring round a cylinder of half-width `rr` at height `y`, seen from above the horizon (`ry` its vertical radius). */
function ring(g: Ctx2D, y: number, rr: number, ry: number): void {
  g.beginPath();
  g.ellipse(0, y, rr, ry, 0, 0.03, Math.PI - 0.03);
}

/** A round flagstone apron: rings and radial joints, moss in the outer joints. */
function paving(
  g: Ctx2D,
  r: Rnd,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  const P = () => {
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  };
  wash(g, P, [cx - rx, cy - ry, cx + rx, cy + ry], "#aaa391", r, {
    blob: 10,
    var: 26,
    shadeA: 0.14,
    lw: 1.3,
  });
  g.save();
  P();
  g.clip();
  ink(g, 0.7, 0.4);
  [0.5, 0.76].forEach((k, j) => {
    g.beginPath();
    g.ellipse(cx, cy, rx * k, ry * k, 0, 0, TAU);
    g.stroke();
    const n = 12 + j * 8;
    for (let i = 0; i < n; i++) {
      const a = ((i + j * 0.5 + r() * 0.2) * TAU) / n;
      const k1 = j ? 1 : 0.76;
      hline(
        g,
        cx + Math.cos(a) * rx * k,
        cy + Math.sin(a) * ry * k,
        cx + Math.cos(a) * rx * k1,
        cy + Math.sin(a) * ry * k1,
        r,
        0.6,
      );
    }
  });
  for (let k = 0; k < 34; k++) {
    const a = r() * TAU;
    const d = 0.5 + r() * 0.5;
    g.fillStyle = r() < 0.5 ? "rgba(98,112,58,.4)" : "rgba(60,54,44,.14)";
    g.beginPath();
    g.ellipse(
      cx + Math.cos(a) * rx * d,
      cy + Math.sin(a) * ry * d,
      3 + r() * 7,
      1.5 + r() * 3,
      0,
      0,
      TAU,
    );
    g.fill();
  }
  g.restore();
}

/** A faceted slate boulder centred on (x, y), `s` its radius. */
function rockLump(g: Ctx2D, x: number, y: number, s: number, rnd: Rnd): void {
  const pts: Pt[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i / (n - 1)) * Math.PI;
    pts.push([
      x + Math.cos(a) * s * (0.8 + rnd() * 0.35),
      y + Math.sin(a) * s * (0.62 + rnd() * 0.3),
    ]);
  }
  pts.push([x + s * 0.9, y + s * 0.15], [x - s * 0.9, y + s * 0.15]);
  castShadow(
    g,
    [
      [x - s * 0.8, y + s * 0.1],
      [x + s, y + s * 0.1],
      [x + s * 1.2, y + s * 0.4],
      [x - s * 0.5, y + s * 0.4],
    ],
    0.32,
  );
  // a boulder is an irregular lump: none of its facets is a receding face of a volume
  withinProjection(g, () => {
    wash(g, () => poly(g, pts), bbox(pts), "#868b92", rnd, {
      blob: s * 0.4,
      var: 22,
      shadeA: 0.35,
    });
    const P = (i: number) => pts[i]!;
    // facets: a lit top plane and a dark right plane
    g.fillStyle = "rgba(220,226,232,.35)";
    poly(g, [
      P(1),
      P(2),
      P(3),
      [x - s * 0.1, y - s * 0.15],
      [x - s * 0.55, y - s * 0.05],
    ]);
    g.fill();
    g.fillStyle = "rgba(30,34,40,.25)";
    poly(g, [
      P(4),
      P(5),
      P(6),
      [x + s * 0.9, y + s * 0.15],
      [x + s * 0.2, y + s * 0.1],
    ]);
    g.fill();
    ink(g, 0.8, 0.45);
    hline(g, x - s * 0.1, y - s * 0.15, P(4)[0], P(4)[1], rnd);
    hline(g, x - s * 0.1, y - s * 0.15, x + s * 0.2, y + s * 0.12, rnd);
  });
}

// ---- ambient life (animate only: no randomness, a pure function of the time)

/** The wind at time `t` (about -0.25..1.25), `ph` apart for each thing it moves: never periodic at a glance. */
const gust = (t: number, ph: number): number =>
  0.5 +
  0.5 * Math.sin(t * 0.31 + ph) * Math.sin(t * 0.77 + ph * 1.7) +
  0.25 * Math.sin(t * 0.13 + ph * 0.6);

/**
 * A window breathing with lamp or candle light, at dusk and night only: a warm
 * veil over the lit glass — a pane `w` × `h` from (x, y), or a round one of
 * radius `w` centred there when `h` is null.
 */
function glowPane(
  g: Ctx2D,
  s: PaintState,
  x: number,
  y: number,
  w: number,
  h: number | null,
  ph: number,
): void {
  if (!s.night && !s.dusk) return;
  const t = s.t;
  const f =
    0.5 +
    0.3 * Math.sin(t * 1.3 + ph) +
    0.2 * Math.sin(t * 3.1 + ph * 2.3) * Math.sin(t * 0.7 + ph);
  g.fillStyle = `rgba(${s.night ? "255,236,170" : "255,206,120"},${(s.night ? 0.3 : 0.38) * Math.max(0, f)})`;
  g.beginPath();
  if (h === null) g.arc(x, y, w, 0, TAU);
  else g.rect(x, y, w, h);
  g.fill();
}

/** A cloth tethered at (x, y), `len` long and `hgt` tall: rippling harder in gusts, drooping in lulls. */
function cloth(
  g: Ctx2D,
  x: number,
  y: number,
  len: number,
  hgt: number,
  t: number,
  ph: number,
  col: string,
): void {
  const gu = Math.max(0.15, gust(t, ph));
  const w = (k: number) =>
    Math.sin(t * (3.4 + gu) - k * 2.4 + ph) * 2.2 * k * gu;
  const droop = (1 - Math.min(1, gu)) * hgt * 0.7;
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(
    x + len * 0.5,
    y + 1 + w(0.5) + droop * 0.4,
    x + len,
    y + hgt * 0.45 + w(1) + droop,
  );
  g.quadraticCurveTo(
    x + len * 0.5,
    y + hgt * 0.8 + w(0.5) + droop * 0.6,
    x,
    y + hgt,
  );
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 1;
  g.lineJoin = "round";
  g.stroke();
}

/** A soft white puff of steam at (x, y), `rad` its radius, at opacity `a`. */
function puff(g: Ctx2D, x: number, y: number, rad: number, a: number): void {
  if (a <= 0.01) return;
  g.fillStyle = `rgba(236,234,224,${a})`;
  g.beginPath();
  g.ellipse(x, y, rad, rad * 0.8, 0, 0, TAU);
  g.fill();
}

/** The length of a polyline. */
function lengthOf(pts: readonly Pt[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    d += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return d;
}

/**
 * Strokes the first `len` px of a polyline (a line being written, in the
 * current stroke style) and returns where the pen is — null once the whole
 * line is down.
 */
function partial(g: Ctx2D, pts: readonly Pt[], len: number): Pt | null {
  const first = pts[0];
  if (!first) return null;
  let left = len;
  let pen: Pt | null = null;
  g.beginPath();
  g.moveTo(first[0], first[1]);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left >= d) {
      g.lineTo(b[0], b[1]);
      left -= d;
    } else {
      const u = left / d;
      pen = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      g.lineTo(pen[0], pen[1]);
      break;
    }
  }
  g.stroke();
  return pen;
}

/** The fittings kit, namespaced. */
export const fittings = {
  TAU,
  INK,
  BRASS,
  BRASS_D,
  BRASS_L,
  GILT,
  VERDIGRIS,
  IRON,
  STONE,
  clamp01,
  ease,
  disc,
  seg,
  ellShadow,
  bar,
  rivet,
  streaks,
  porthole,
  drum,
  metal,
  ring,
  paving,
  rockLump,
  gust,
  glowPane,
  cloth,
  puff,
  lengthOf,
  partial,
};
