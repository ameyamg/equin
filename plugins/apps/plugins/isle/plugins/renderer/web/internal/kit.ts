// The renderer's small drawing kit: canvases, sprites (drawn once at 2×,
// placed by their ground anchor), inked
// lines and irregular blobs.

import { mulberry32 } from "@plugins/packages/plugins/seeded-random/core";
import { fnv1a32 } from "@plugins/packages/plugins/string-hash/core";

export type Ctx = CanvasRenderingContext2D;
export type Rnd = () => number;

export const INK = "rgba(48,38,28,.82)";

/** A seeded random stream (the prototype's `seeded`). */
export const seeded = (s: number): Rnd => mulberry32(s);
/** FNV-1a of a string (the prototype's `strHash`). */
export const strHash = (s: string): number => fnv1a32(s);

/** How many boulder sprites there are, and each one's size (px): the furniture places them by index. */
export const ROCK_COUNT = 20;
export const rockSize = (i: number): number => 14 + (i % 7) * 7;

/** A detached canvas of the given pixel size. */
export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** A canvas's 2D context, loudly. */
export function ctx2d(
  c: HTMLCanvasElement,
  opts?: CanvasRenderingContext2DSettings,
): Ctx {
  const g = c.getContext("2d", opts);
  if (!g) throw new Error("isle renderer: no 2D context");
  return g;
}

/** A sprite: drawn once at 2× into its own canvas, placed by its anchor (ax, ay = the ground point). */
export interface Sprite {
  readonly c: HTMLCanvasElement;
  readonly w: number;
  readonly h: number;
  readonly ax: number;
  readonly ay: number;
  /**
   * The box that decides where it may stand, when that is not its own: a
   * repainted sprite keeps the box of the one it replaced, so the same things
   * stand in the same places (`scene.ts`).
   */
  readonly fit?: SpriteBox;
  /** The thing itself, without its cast shadow, anchor-relative: [x0, y0, x1, y1]. */
  readonly vis?: readonly [number, number, number, number];
}

/** A sprite's box: its size and its anchor in it. */
export interface SpriteBox {
  readonly w: number;
  readonly h: number;
  readonly ax: number;
  readonly ay: number;
}

export function sprite(
  w: number,
  h: number,
  ax: number,
  ay: number,
  draw: (g: Ctx) => void,
): Sprite {
  const c = canvas(w * 2, h * 2);
  const g = ctx2d(c);
  g.scale(2, 2);
  g.translate(ax, ay);
  draw(g);
  return { c, w, h, ax, ay };
}

/**
 * A sprite painted when it is first drawn, not when it is declared: the
 * detailed scenery (a dozen trees, each thousands of dabs) is painted a sprite
 * at a time by the tiles that show it, within their bake budget — never all at
 * once in the task that opens the island. Its painter must own its random
 * stream (painting order is the tiles').
 */
export function lazySprite(
  w: number,
  h: number,
  ax: number,
  ay: number,
  draw: (g: Ctx) => void,
  extra: Pick<Sprite, "fit" | "vis"> = {},
): Sprite {
  let made: HTMLCanvasElement | null = null;
  return {
    w,
    h,
    ax,
    ay,
    ...extra,
    get c() {
      return (made ??= sprite(w, h, ax, ay, draw).c);
    },
  };
}

/**
 * Places a sprite with its anchor at (x, y), scaled by k; `cut`: its cut-out
 * only (`solid-mask.ts`'s `Cutter`, typed here structurally so the kit stays a leaf).
 */
export function put(
  g: Ctx,
  s: Sprite,
  x: number,
  y: number,
  k = 1,
  cut?: (c: HTMLCanvasElement) => CanvasImageSource,
): void {
  g.drawImage(
    cut ? cut(s.c) : s.c,
    x - s.ax * k,
    y - s.ay * k,
    s.w * k,
    s.h * k,
  );
}

export function blobPath(
  x: number,
  y: number,
  r: number,
  rnd: Rnd,
  n = 9,
  jit = 0.28,
): Path2D {
  const P = new Path2D();
  for (let i = 0; i <= n; i++) {
    const a = ((i % n) / n) * Math.PI * 2;
    const rr = r * (1 - jit / 2 + rnd() * jit);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr * 0.92;
    if (i) P.lineTo(px, py);
    else P.moveTo(px, py);
  }
  P.closePath();
  return P;
}

/** An irregular closed shape, as the current path. */
export function blob(
  g: Ctx,
  x: number,
  y: number,
  r: number,
  rnd: Rnd,
  n = 9,
  jit = 0.28,
): void {
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = ((i % n) / n) * Math.PI * 2;
    const rr = r * (1 - jit / 2 + rnd() * jit);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr * 0.92;
    if (i) g.lineTo(px, py);
    else g.moveTo(px, py);
  }
  g.closePath();
}

export function inkLine(
  g: Ctx,
  pts: readonly (readonly [number, number])[],
  w = 1.1,
  col = INK,
): void {
  g.strokeStyle = col;
  g.lineWidth = w;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
}

/** A soft round glow of one colour, drawn once and stamped. */
const GLOWS = new Map<string, HTMLCanvasElement>();
export function glowSprite(col: string): HTMLCanvasElement {
  const hit = GLOWS.get(col);
  if (hit) return hit;
  const c = canvas(128, 128);
  const g = ctx2d(c);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, col);
  gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  GLOWS.set(col, c);
  return c;
}

/** Smoothstep of x between a and b. */
export const ss = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- the buildings' medium, for the scenery: a fine wobbly ink line, washes
// with granulation, light from the upper left, shadows to the lower right ----

const TONES = new Map<string, string>();
/** A `#rrggbb` colour at alpha a, as CSS. */
export function tone(hex: string, a = 1): string {
  const k = hex + a;
  let s = TONES.get(k);
  if (!s) {
    const n = parseInt(hex.slice(1), 16);
    s = `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
    TONES.set(k, s);
  }
  return s;
}

/** The pen's ink at alpha a. */
export const pen = (a: number): string => `rgba(48,38,28,${a})`;

/** Watercolour granulation over what is painted so far (source-atop keeps it inside the drawing). */
export function grain(
  g: Ctx,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rnd: Rnd,
  k = 1,
): void {
  g.save();
  g.globalCompositeOperation = "source-atop";
  for (let i = 0; i < ((w * h) / 900) * k; i++) {
    g.fillStyle = rnd() < 0.6 ? "rgba(70,56,30,.07)" : "rgba(255,246,214,.05)";
    g.beginPath();
    g.ellipse(
      x0 + rnd() * w,
      y0 + rnd() * h,
      5 + rnd() * 16,
      3 + rnd() * 10,
      rnd() * 3,
      0,
      7,
    );
    g.fill();
  }
  for (let i = 0; i < ((w * h) / 30) * k; i++) {
    g.fillStyle = rnd() < 0.55 ? "rgba(40,34,20,.14)" : "rgba(255,250,226,.12)";
    g.fillRect(
      x0 + rnd() * w,
      y0 + rnd() * h,
      0.7 + rnd() * 0.6,
      0.7 + rnd() * 0.6,
    );
  }
  g.restore();
}

/** A hand-inked line through points: the pen's pass, then a lighter one beside it, as on the buildings. */
export function penLine(
  g: Ctx,
  pts: readonly (readonly [number, number])[],
  rnd: Rnd,
  w = 1.1,
  a = 0.8,
  wob = 0.6,
): void {
  g.lineCap = "round";
  g.lineJoin = "round";
  for (let pass = 0; pass < 2; pass++) {
    g.strokeStyle = pen(pass ? a * 0.35 : a);
    g.lineWidth = pass ? w * 0.55 : w;
    g.beginPath();
    const o = pass ? 0.5 : 0;
    const k = wob * (pass ? 2 : 1);
    pts.forEach(([x, y], i) => {
      const px = x + (rnd() - 0.5) * k + o;
      const py = y + (rnd() - 0.5) * k + o * 0.8;
      const prev = pts[i - 1];
      if (!prev) g.moveTo(px, py);
      else
        g.quadraticCurveTo(
          (prev[0] + x) / 2 + (rnd() - 0.5) * wob * 2,
          (prev[1] + y) / 2 + (rnd() - 0.5) * wob * 2,
          px,
          py,
        );
    });
    g.stroke();
  }
}

/** A smooth closed curve through the midpoints of a ring of points. */
export function ring(pts: readonly (readonly [number, number])[]): Path2D {
  const P = new Path2D();
  const n = pts.length;
  const last = pts[n - 1]!;
  const first = pts[0]!;
  P.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    P.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  P.closePath();
  return P;
}

/** A small inked stone: its shadow to the lower right, a lit top-left. */
export function stone(
  g: Ctx,
  x: number,
  y: number,
  rad: number,
  t: number,
  rot: number,
): void {
  g.fillStyle = "rgba(40,36,26,.26)";
  g.beginPath();
  g.ellipse(x + rad * 0.35, y + rad * 0.4, rad, rad * 0.62, rot, 0, 7);
  g.fill();
  g.fillStyle = `rgb(${(146 + t * 44) | 0},${(142 + t * 40) | 0},${(130 + t * 36) | 0})`;
  g.beginPath();
  g.ellipse(x, y, rad, rad * 0.72, rot, 0, 7);
  g.fill();
  g.strokeStyle = "rgba(48,40,32,.6)";
  g.lineWidth = 0.7;
  g.stroke();
  if (rad > 2.2) {
    g.fillStyle = "rgba(240,236,220,.4)";
    g.beginPath();
    g.ellipse(x - rad * 0.3, y - rad * 0.25, rad * 0.42, rad * 0.26, rot, 0, 7);
    g.fill();
  }
}

/** A few blades of grass round a thing's foot, planting it in the meadow. */
export function footGrass(g: Ctx, rnd: Rnd, w: number): void {
  g.lineCap = "round";
  g.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    const x = (rnd() - 0.5) * w * 2.4;
    const y = 1.2 + rnd() * 1.6;
    g.strokeStyle =
      rnd() < 0.55 ? "rgba(60,72,36,.85)" : "rgba(142,152,86,.85)";
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(
      x + (rnd() - 0.5) * 2,
      y - 3,
      x + (rnd() - 0.5) * 4,
      y - 4 - rnd() * 4,
    );
    g.stroke();
  }
}
