// The painting kit's building parts and small props: windows, doors, steps,
// crates, barrels, sacks, a bench, books, a lantern, smoke, the light that
// spills from an open door.

import type { Chimney, Ctx2D, Door, Doorway } from "../spec";
import { at, jit, type Rnd } from "./colour";
import { castShadow, hline, ink, planks, wash } from "./draw";
import { oblique } from "./oblique";

export interface WindowOptions {
  /** Warm light behind the glass (night). */
  lit?: boolean;
  frame?: string;
  sill?: string;
  /** An arched top. */
  arch?: boolean;
  /** Shutter colour: shutters either side. */
  shutters?: string | null;
}

/** A window; (x, y) is the bottom-left of the opening. */
export function windowRect(
  g: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: Rnd,
  o: WindowOptions = {},
): void {
  const lit = o.lit;
  const frame = o.frame ?? "#5d4a35";
  g.fillStyle = "rgba(40,34,26,.5)";
  g.fillRect(x - 3, y, w + 6, 4); // sill shadow
  g.fillStyle = o.sill ?? "#a9a291";
  g.fillRect(x - 3, y - 1, w + 6, 4);
  ink(g, 0.9, 0.6);
  g.strokeRect(x - 3, y - 1, w + 6, 4);
  const top = y - h;
  const path = () => {
    g.beginPath();
    if (o.arch) {
      g.moveTo(x, y);
      g.lineTo(x, top + w / 2);
      g.arc(x + w / 2, top + w / 2, w / 2, Math.PI, 0);
      g.lineTo(x + w, y);
      g.closePath();
    } else g.rect(x, top, w, h);
  };
  path();
  g.fillStyle = frame;
  g.fill();
  g.save();
  g.translate(x + w / 2, 0);
  g.scale((w - 4) / w, 1);
  g.translate(-x - w / 2, 0);
  g.beginPath();
  if (o.arch) {
    g.moveTo(x, y - 2);
    g.lineTo(x, top + w / 2 + 2);
    g.arc(x + w / 2, top + w / 2 + 2, w / 2, Math.PI, 0);
    g.lineTo(x + w, y - 2);
    g.closePath();
  } else g.rect(x, top + 2, w, h - 4);
  const gl = g.createLinearGradient(x, top, x + w, y);
  if (lit) {
    gl.addColorStop(0, "#ffe2a0");
    gl.addColorStop(1, "#e7a54e");
  } else {
    gl.addColorStop(0, "#7d8a8e");
    gl.addColorStop(0.5, "#4d585e");
    gl.addColorStop(1, "#353d42");
  }
  g.fillStyle = gl;
  g.fill();
  g.restore();
  if (!lit) {
    g.save();
    path();
    g.clip();
    g.strokeStyle = "rgba(220,230,230,.28)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x + 2, y - h * 0.35);
    g.lineTo(x + w * 0.6, top + 2);
    g.stroke();
    g.restore();
  }
  g.strokeStyle = frame;
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(x + w / 2, top + 2);
  g.lineTo(x + w / 2, y);
  g.moveTo(x + 1, y - h * 0.48);
  g.lineTo(x + w - 1, y - h * 0.48);
  g.stroke();
  path();
  ink(g, 1.1);
  g.stroke();
  if (o.shutters) {
    const sc = o.shutters;
    for (const sx of [x - w / 2 - 2, x + w + 2]) {
      planks(g, sx, top, sx + w / 2, y, rnd, { base: sc, pw: 4 });
    }
  }
}

export interface DoorArchOptions {
  /** Door colour. */
  col?: string;
  /** A stone surround (default on). */
  surround?: boolean;
}

/** An arched plank door, centred on `x`, its bottom at `y`. */
export function doorArch(
  g: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: Rnd,
  o: DoorArchOptions = {},
): void {
  const x0 = x - w / 2;
  const top = y - h;
  const path = () => {
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x0, top + w / 2);
    g.arc(x, top + w / 2, w / 2, Math.PI, 0);
    g.lineTo(x0 + w, y);
    g.closePath();
  };
  g.save();
  path();
  g.clip();
  planks(g, x0, top, x0 + w, y, rnd, { base: o.col ?? "#6a5038", pw: 6 });
  g.restore();
  path();
  ink(g, 1.5);
  g.stroke();
  if (o.surround !== false) {
    g.save();
    g.strokeStyle = "#9a9384";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(x0 - 2, y);
    g.lineTo(x0 - 2, top + w / 2);
    g.arc(x, top + w / 2, w / 2 + 2, Math.PI, 0);
    g.lineTo(x0 + w + 2, y);
    g.stroke();
    g.restore();
    ink(g, 0.8, 0.5);
    g.beginPath();
    g.moveTo(x0 - 4, y);
    g.lineTo(x0 - 4, top + w / 2);
    g.arc(x, top + w / 2, w / 2 + 4, Math.PI, 0);
    g.lineTo(x0 + w + 4, y);
    g.stroke();
  }
  g.fillStyle = "#2e2a26";
  for (const hy of [top + h * 0.3, y - h * 0.22])
    g.fillRect(x0 + 1, hy, w * 0.42, 2); // iron straps
  g.fillStyle = "#c2a060";
  g.beginPath();
  g.arc(x + w * 0.3, y - h * 0.45, 1.6, 0, 7);
  g.fill();
}

/** A step's riser height and its tread's depth, px. */
const STEP_RISE = 2.2;
const STEP_TREAD = 3.8;

/**
 * `n` stone steps up to a door centred on `x`, the top tread meeting the wall
 * at `y`. They come out of the wall toward the viewer — down and to the left,
 * along the receding vector backwards — each a slab showing its riser, its
 * tread from above and its right end; each lower one 8 px wider.
 */
export function steps(
  g: Ctx2D,
  x: number,
  y: number,
  w: number,
  n: number,
  rnd: Rnd,
): void {
  const cols = Array.from({ length: n }, () => jit("#a49d8c", rnd, 14));
  // from the wall outward: each slab stands in front of the one above it
  for (let i = n - 1; i >= 0; i--) {
    const k = n - i;
    const ww = w + k * 8;
    const col = cols[i] ?? "#a49d8c";
    const [x0, yt] = oblique.back(
      [x - ww / 2, y + (k - 1) * STEP_RISE],
      -k * STEP_TREAD,
    );
    oblique.solid(
      g,
      { x0, x1: x0 + ww, yb: yt + STEP_RISE, yt, d: STEP_TREAD },
      {
        side: (d, t, b) => {
          g.fillStyle = col;
          g.fillRect(0, t, d, b - t);
        },
        top: (a, b, d) => {
          g.fillStyle = col;
          g.fillRect(a, 0, b - a, d);
          g.fillStyle = "rgba(255,250,236,.22)";
          g.fillRect(a, 0, b - a, d);
        },
        front: ([a, t, b, f]) => {
          g.fillStyle = col;
          g.fillRect(a, t, b - a, f - t);
          g.fillStyle = "rgba(30,26,20,.2)";
          g.fillRect(a, t, b - a, f - t);
        },
        shade: 0.34,
        ink: 0,
      },
    );
    const f = oblique.box({
      x0,
      x1: x0 + ww,
      yb: yt + STEP_RISE,
      yt,
      d: STEP_TREAD,
    });
    for (const face of [f.top, f.side, f.front])
      oblique.inkFace(g, face, 0.9, 0.6);
  }
}

/** A crate of side `s` standing at (x, y): its front, its top and its right side receding. */
export function crate(
  g: Ctx2D,
  x: number,
  y: number,
  s: number,
  rnd: Rnd,
): void {
  castShadow(
    g,
    [
      [x, y],
      [x + s, y],
      [x + s + 6, y + 4],
      [x + 6, y + 4],
    ],
    0.3,
  );
  planks(g, x, y - s, x + s, y, rnd, {
    base: "#a08460",
    vertical: false,
    pw: s / 3,
  });
  ink(g, 1, 0.6);
  g.beginPath();
  g.moveTo(x + 2, y - 2);
  g.lineTo(x + s - 2, y - s + 2);
  g.stroke();
  const top = jit("#b49a72", rnd, 10);
  oblique.solid(
    g,
    { x0: x, x1: x + s, yb: y, yt: y - s, d: 5 },
    {
      side: (d, yt, yb) => {
        g.fillStyle = "#8a7050";
        g.fillRect(0, yt, d, yb - yt);
      },
      top: (x0, x1, d) => {
        g.fillStyle = top;
        g.fillRect(x0, 0, x1 - x0, d);
      },
      front: () => {},
      shade: 0.12,
      ink: 0.9,
    },
  );
}

/** A barrel of radius `r` standing at (x, y); 2.3 r tall. */
export function barrel(
  g: Ctx2D,
  x: number,
  y: number,
  r: number,
  rnd: Rnd,
): void {
  castShadow(
    g,
    [
      [x - r, y],
      [x + r, y],
      [x + r + 7, y + 4],
      [x - r + 7, y + 4],
    ],
    0.3,
  );
  const h = r * 2.3;
  g.save();
  g.beginPath();
  g.moveTo(x - r, y);
  g.quadraticCurveTo(x - r * 1.15, y - h / 2, x - r, y - h);
  g.lineTo(x + r, y - h);
  g.quadraticCurveTo(x + r * 1.15, y - h / 2, x + r, y);
  g.closePath();
  g.clip();
  planks(g, x - r * 1.2, y - h, x + r * 1.2, y, rnd, {
    base: "#80664a",
    pw: r / 2.2,
  });
  g.restore();
  ink(g, 1.2);
  g.beginPath();
  g.moveTo(x - r, y);
  g.quadraticCurveTo(x - r * 1.15, y - h / 2, x - r, y - h);
  g.lineTo(x + r, y - h);
  g.quadraticCurveTo(x + r * 1.15, y - h / 2, x + r, y);
  g.stroke();
  g.strokeStyle = "#4a4640";
  g.lineWidth = 2;
  for (const k of [0.22, 0.78]) {
    g.beginPath();
    g.moveTo(x - r * 1.08, y - h * k);
    g.lineTo(x + r * 1.08, y - h * k);
    g.stroke();
  }
  g.fillStyle = "#6e573f";
  g.beginPath();
  g.ellipse(x, y - h, r, r * 0.38, 0, 0, 7);
  g.fill();
  ink(g, 1);
  g.stroke();
}

/** A sack of half-width `s` standing at (x, y); 1.7 s tall. */
export function sack(
  g: Ctx2D,
  x: number,
  y: number,
  s: number,
  rnd: Rnd,
): void {
  castShadow(
    g,
    [
      [x - s, y],
      [x + s, y],
      [x + s + 5, y + 3],
      [x - s + 5, y + 3],
    ],
    0.25,
  );
  const outline = () => {
    g.beginPath();
    g.moveTo(x - s, y);
    g.quadraticCurveTo(x - s * 1.2, y - s * 1.2, x - s * 0.3, y - s * 1.6);
    g.lineTo(x + s * 0.3, y - s * 1.7);
    g.quadraticCurveTo(x + s * 1.2, y - s * 1.1, x + s, y);
    g.closePath();
  };
  wash(g, outline, [x - s * 1.2, y - s * 1.8, x + s * 1.2, y], "#bba57c", rnd, {
    blob: 4,
  });
  ink(g, 0.8, 0.5);
  hline(g, x - s * 0.3, y - s * 1.45, x + s * 0.3, y - s * 1.5, rnd);
}

/** A wooden bench `w` wide at (x, y), with a back. */
export function bench(
  g: Ctx2D,
  x: number,
  y: number,
  w: number,
  rnd: Rnd,
): void {
  castShadow(
    g,
    [
      [x, y],
      [x + w, y],
      [x + w + 6, y + 5],
      [x + 6, y + 5],
    ],
    0.25,
  );
  g.fillStyle = "#5c4a36";
  for (const lx of [x + 3, x + w - 6]) g.fillRect(lx, y - 9, 3, 9);
  // the seat, seen from above, behind its front edge
  oblique.onTop(g, y - 13, () => {
    g.fillStyle = "#9c8463";
    g.fillRect(x, 0, w, 6);
    ink(g, 0.8, 0.6);
    g.strokeRect(x, 0, w, 6);
  });
  planks(g, x, y - 13, x + w, y - 9, rnd, {
    base: "#8a7253",
    vertical: false,
    pw: 4,
  });
  planks(g, x, y - 24, x + w, y - 17, rnd, {
    base: "#7d6648",
    vertical: false,
    pw: 3.5,
  });
  g.fillStyle = "#5c4a36";
  g.fillRect(x + 3, y - 24, 2.5, 12);
  g.fillRect(x + w - 6, y - 24, 2.5, 12);
}

const BOOK_COLOURS = [
  "#6e3f34",
  "#3f4f5e",
  "#5a5a3a",
  "#7a6542",
  "#4b3a4e",
  "#8a7a5a",
] as const;

/** A stack of `n` books whose bottom edge is at `y`. */
export function books(
  g: Ctx2D,
  x: number,
  y: number,
  n: number,
  rnd: Rnd,
): void {
  let yy = y;
  for (let i = 0; i < n; i++) {
    const w = 18 + rnd() * 6;
    const h = 3.4 + rnd() * 1.4;
    const xx = x + (rnd() - 0.5) * 4;
    g.fillStyle = at(BOOK_COLOURS, (rnd() * BOOK_COLOURS.length) | 0);
    g.fillRect(xx, yy - h, w, h);
    g.fillStyle = "#e8dcc0";
    g.fillRect(xx + w - 2.5, yy - h + 0.6, 2, h - 1.2);
    ink(g, 0.7, 0.7);
    g.strokeRect(xx, yy - h, w, h);
    yy -= h;
  }
}

/** A small hanging lantern at (x, y); `lit` glows warm. */
export function lantern(g: Ctx2D, x: number, y: number, lit: boolean): void {
  ink(g, 1);
  g.beginPath();
  g.moveTo(x, y - 8);
  g.lineTo(x, y - 12);
  g.stroke();
  g.fillStyle = "#3a352f";
  g.fillRect(x - 4, y - 9, 8, 2);
  g.fillStyle = lit ? "#ffd27a" : "#c9c0a4";
  g.fillRect(x - 3, y - 7, 6, 8);
  g.fillStyle = "#3a352f";
  g.fillRect(x - 4, y + 1, 8, 2);
  ink(g, 0.8);
  g.strokeRect(x - 3, y - 7, 6, 8);
}

/** Chimney smoke rising from (x, y): `n` puffs drifting up and right with time `t`, at opacity `a`. */
export function smoke(
  g: Ctx2D,
  x: number,
  y: number,
  t: number,
  n = 6,
  spread = 1,
  a = 1,
): void {
  for (let i = 0; i < n; i++) {
    const k = (t * 0.18 + i / n) % 1;
    g.fillStyle = `rgba(226,224,214,${a * 0.42 * (1 - k) * Math.min(1, k * 6)})`;
    g.beginPath();
    g.ellipse(
      x + Math.sin(k * 5 + i) * 5 * spread + k * 26 * spread,
      y - k * 70,
      5 + k * 14,
      4 + k * 10,
      0,
      0,
      7,
    );
    g.fill();
  }
}

/** A building's chimney smoke at time `t`, `amount` thick (0: none, 1: a busy hearth). */
export function chimneySmoke(
  g: Ctx2D,
  c: Chimney,
  t: number,
  amount: number,
): void {
  if (amount <= 0) return;
  smoke(g, c.x, c.y, t + (c.phase ?? 0), c.puffs ?? 6, c.spread ?? 1, amount);
}

/** How deep a doorway's reveal is (the wall's thickness), px of depth. */
const REVEAL = 6;

/** The doorway's outline, its threshold at `y`, shifted `dx`, `dy`. */
function doorwayPath(g: Ctx2D, d: Doorway, dx = 0, dy = 0): void {
  const y = (d.y ?? 0) + dy;
  const L = -d.w / 2 + dx;
  const R = d.w / 2 + dx;
  const spring = y - d.h + d.head;
  g.beginPath();
  g.moveTo(L, y);
  g.lineTo(L, spring);
  if (d.head > 0) g.ellipse(dx, spring, d.w / 2, d.head, 0, Math.PI, 0);
  else g.lineTo(R, spring);
  g.lineTo(R, y);
  g.closePath();
}

/**
 * The light an open doorway throws on the ground in front: a soft fan, thrown
 * toward the viewer (down and to the left, the receding vector backwards),
 * fading to nothing at its edges — no hard side.
 */
function spill(g: Ctx2D, d: Doorway, a: number): void {
  const y = d.y ?? 0;
  const rx = d.w / 2 + 12;
  const ry = 24;
  g.save();
  g.beginPath();
  g.rect(-rx - 6, y, 2 * rx + 6, ry);
  g.clip();
  g.translate(-6, y);
  g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, `rgba(255,206,128,${a})`);
  gr.addColorStop(0.55, `rgba(255,196,112,${a * 0.45})`);
  gr.addColorStop(1, "rgba(255,190,100,0)");
  g.fillStyle = gr;
  g.fillRect(-rx, 0, 2 * rx, rx);
  g.restore();
}

/**
 * A building's door, open: what the engine draws over the building while the
 * player stands at it.
 *
 * - A `leaf` has swung in out of sight: the doorway shows the wall's thickness
 *   — its left reveal and its sill, the faces the high 3/4 view sees — and,
 *   beyond, a room lit warm from within: its floor running back to the far
 *   wall, a lamp's glow.
 * - An `opening` keeps what the building painted inside it; its lamps come on:
 *   a warm glow over the doorway.
 *
 * Either way the light spills out over the ground.
 */
export function openDoor(g: Ctx2D, door: Door): void {
  const y = door.y ?? 0;
  const top = y - door.h;
  if (door.kind === "opening") {
    g.save();
    doorwayPath(g, door);
    g.clip();
    g.globalCompositeOperation = "lighter";
    const gr = g.createRadialGradient(
      0,
      y - door.h * 0.4,
      0,
      0,
      y - door.h * 0.4,
      Math.max(door.w, door.h) * 0.65,
    );
    gr.addColorStop(0, "rgba(255,170,80,.42)");
    gr.addColorStop(1, "rgba(255,150,60,.08)");
    g.fillStyle = gr;
    g.fillRect(-door.w / 2, top, door.w, door.h);
    g.restore();
    spill(g, door, 0.42);
    return;
  }
  const [bx, by] = oblique.back([0, 0], REVEAL);
  const L = -door.w / 2;
  g.save();
  doorwayPath(g, door);
  g.clip();
  // the reveal: the wall's thickness, in shadow (its left side faces the room's light a little)
  const rv = g.createLinearGradient(L, 0, L + bx, 0);
  rv.addColorStop(0, "#5a412b");
  rv.addColorStop(1, "#7a5838");
  g.fillStyle = rv;
  g.fillRect(L - 1, top - 1, door.w + 2, door.h + 2);
  // the sill: the threshold's top, lit from inside
  g.fillStyle = "#b99566";
  g.beginPath();
  g.moveTo(L, y);
  g.lineTo(-L, y);
  g.lineTo(-L + bx, y + by);
  g.lineTo(L + bx, y + by);
  g.closePath();
  g.fill();
  // the room, through the doorway's far edge
  doorwayPath(g, door, bx, by);
  g.clip();
  const back = y + by; // where the floor meets the doorway's far edge
  const wallFoot = back - Math.min(9, door.h * 0.16); // the floor meets the far wall
  const room = g.createLinearGradient(0, top + by, 0, wallFoot);
  room.addColorStop(0, "#4a2c18");
  room.addColorStop(1, "#c07c3c");
  g.fillStyle = room;
  g.fillRect(L, top + by - 1, door.w + bx, door.h + 2);
  // the floor, lit: brightest by the far wall, under the lamp
  const fl = g.createLinearGradient(0, wallFoot, 0, back);
  fl.addColorStop(0, "#f4c47a");
  fl.addColorStop(1, "#b87a42");
  g.fillStyle = fl;
  g.fillRect(L, wallFoot, door.w + bx, back - wallFoot + 1);
  // the lamp's glow on the far wall
  const lx = bx * 0.6;
  const ly = wallFoot - door.h * 0.38;
  const glow = g.createRadialGradient(lx, ly, 0, lx, ly, door.h * 0.55);
  glow.addColorStop(0, "rgba(255,226,160,.95)");
  glow.addColorStop(0.5, "rgba(255,196,110,.45)");
  glow.addColorStop(1, "rgba(255,180,90,0)");
  g.fillStyle = glow;
  g.fillRect(L, top + by - 1, door.w + bx, door.h + 2);
  // the floor's far edge, faint
  ink(g, 0.8, 0.25);
  g.beginPath();
  g.moveTo(L, wallFoot);
  g.lineTo(-L + bx, wallFoot);
  g.stroke();
  g.restore();
  // the doorway's far edge, inked faint over the reveal
  g.save();
  doorwayPath(g, door);
  g.clip();
  ink(g, 0.8, 0.45);
  doorwayPath(g, door, bx, by);
  g.stroke();
  g.restore();
  spill(g, door, 0.5);
}
