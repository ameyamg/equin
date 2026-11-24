// Studio's building on Isle: the block workshop — a house put together from
// jigsaw blocks that tenon into one another, each in its own material (coursed
// stone, oak boards with the door, boards in faded paint, lime plaster in an
// oak frame, riveted copper), around a mast carrying a brass hub of six lugs
// whose copper pipes run to every block. It is the app at work: the crane
// lifts the copper block out of its socket, holds it and slots it back; pulses
// of light run from the hub out along every pipe; a brass lens on an arm
// sweeps the stonework, magnifying it, and dwells.

import {
  accent,
  bbox,
  castShadow,
  crate,
  doorArch,
  fittings,
  grain,
  ink,
  ivy,
  lantern,
  mix,
  moss,
  oblique,
  planks,
  poly,
  polyKit,
  shrub,
  steps,
  stones,
  tufts,
  wash,
  windowRect,
  type Box,
  type BuildingSpec,
  type Ctx2D,
  type Face,
  type PaintState,
  type Pt,
  type Rnd,
} from "@plugins/apps/plugins/isle/plugins/buildings/core";

const {
  TAU,
  INK,
  BRASS,
  BRASS_D,
  BRASS_L,
  IRON,
  clamp01,
  ease,
  disc,
  seg,
  bar,
  rivet,
  streaks,
  glowPane,
} = fittings;
const { parkMiller } = polyKit;

const GRAIN_BOX: Box = [-210, -262, 222, 66];
const COPPER = "#9a6f4c";
/** The hub on the mast, the mast's top, the crane's jib end, the lens arm's pivot, its length and the lens's radius. */
const HUB: Pt = [0, -150];
const MAST = -232;
const JIB: Pt = [80, -218];
const PIV: Pt = [-114, -98];
const ARM = 62;
const LR = 16;
/** The copper block the crane lifts, at rest: left, right, top, bottom; and the middle of its width. */
const EX0 = 52;
const EX1 = 108;
const EY0 = -150;
const EY1 = -96;
const EM = (EX0 + EX1) / 2;
/** The upper (plaster) block: left, top, right, bottom. */
const UP = [-106, -176, -24, -96] as const;
/** The copper pipes, each from the hub to a block (the last runs up the mast to the lamp). */
const PIPES: readonly (readonly Pt[])[] = [
  [
    [0, -150],
    [-46, -150],
  ],
  [
    [0, -150],
    [-16, -134],
    [-16, -76],
    [-98, -76],
  ],
  [
    [0, -150],
    [0, -74],
  ],
  [
    [0, -150],
    [26, -124],
    [26, -72],
    [68, -72],
  ],
  [
    [0, -150],
    [0, -235],
  ],
];

/** 0 → 1 between `a` and `b`, eased. */
const ss = (a: number, b: number, x: number): number =>
  ease(clamp01((x - a) / (b - a)));

/**
 * A jigsaw tab on one edge: +1 a knob out, -1 a socket in, 0 none; `at` where
 * along the edge (default the middle); `flush` when it sits in a neighbour's
 * socket, face to face — only a knob that stands free shows its thickness.
 */
type Tab =
  | 0
  | 1
  | -1
  | { readonly dir: 1 | -1; readonly at: number; readonly flush?: boolean };
/** A block's four edges: top, right, bottom, left. */
type Tabs = readonly [Tab, Tab, Tab, Tab];

/** The knob: its head's radius, its neck's half-width and height, the head's centre. */
const RR = 11;
const NW = 6;
const V0 = 4;
const CV = V0 + Math.sqrt(RR * RR - NW * NW);
const AL = Math.asin(NW / RR);

/** The outline of the tab on the edge a → b, from the edge out round the head and back to it (none: no points). */
function tabPts(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  tab: Tab,
): Pt[] {
  if (tab === 0) return [];
  const L = Math.hypot(bx - ax, by - ay);
  const dx = (bx - ax) / L;
  const dy = (by - ay) / L;
  const dir = typeof tab === "number" ? tab : tab.dir;
  const m = L * (typeof tab === "number" ? 0.5 : tab.at);
  const P = (u: number, v: number): Pt => [
    ax + dx * u + dy * v * dir,
    ay + dy * u - dx * v * dir,
  ];
  const pts = [P(m - NW, 0)];
  for (let i = 0; i <= 16; i++) {
    const phi = -(Math.PI - AL) + (2 * (Math.PI - AL) * i) / 16;
    pts.push(P(m + RR * Math.sin(phi), CV + RR * Math.cos(phi)));
  }
  pts.push(P(m + NW, 0));
  return pts;
}

/** Continues the path along a jigsaw edge from a to b (the path runs clockwise: the outside is on the left of travel). */
function edge(
  g: Ctx2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  tab: Tab,
): void {
  for (const [x, y] of tabPts(ax, ay, bx, by, tab)) g.lineTo(x, y);
  g.lineTo(bx, by);
}

/** A block's four edges as a → b, clockwise from the top-left corner. */
const edgesOf = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): readonly (readonly [number, number, number, number])[] => [
  [x0, y0, x1, y0],
  [x1, y0, x1, y1],
  [x1, y1, x0, y1],
  [x0, y1, x0, y0],
];

/** The outline of a block's front face. */
function piecePath(
  g: Ctx2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tabs: Tabs,
): void {
  g.beginPath();
  g.moveTo(x0, y0);
  edge(g, x0, y0, x1, y0, tabs[0]);
  edge(g, x1, y0, x1, y1, tabs[1]);
  edge(g, x1, y1, x0, y1, tabs[2]);
  edge(g, x0, y1, x0, y0, tabs[3]);
  g.closePath();
}

/** How deep every block is (its top and right faces recede that far), and how far a knob reaches out of a face. */
const PD = 18;
const PAD = RR + CV + 2;

/**
 * The thickness of a tab, `PD` deep like its block: a knob shows its top and
 * its right flank. A socket is cut INTO the block (its outline runs the other
 * way round): through its mouth, and through the `cut` it makes in the block's
 * top or side, the hollow shows dark with the walls the view can see
 * (`oblique.rim` works out which). `mat`: the material's colour.
 */
function tabDepth(
  g: Ctx2D,
  pts: readonly Pt[],
  mat: string,
  cut: Face | null,
): void {
  const rim = oblique.rim(pts, PD);
  const col = (k: number) => (up: number) =>
    mix(mix(mat, "#1c1814", k), mat, up * 0.8);
  if (area(pts) > 0) {
    oblique.paintRim(g, rim, col(0.36));
    return;
  }
  const mouth = oblique.project(pts.map(([x, y]) => [x, 0, -y] as const));
  for (const win of cut ? [mouth, cut] : [mouth])
    oblique.fill(g, win, (q) => {
      g.save();
      poly(g, q);
      g.clip();
      g.fillStyle = "#241d16";
      for (const f of [mouth, ...rim.swept]) {
        poly(g, f);
        g.fill();
      }
      oblique.paintRim(g, rim, col(0.5), 0.9);
      g.restore();
    });
}

/** The stretches of a polyline that lie above the line y = `y` (cut where it crosses). */
function above(pts: readonly Pt[], y: number): Pt[][] {
  const out: Pt[][] = [];
  let run: Pt[] | null = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[i - 1];
    const cross = (): Pt => {
      const k = (y - q![1]) / (p[1] - q![1]);
      return [q![0] + (p[0] - q![0]) * k, y];
    };
    if (p[1] < y) {
      if (!run) out.push((run = q ? [cross()] : []));
      run.push(p);
    } else if (run) {
      run.push(cross());
      run = null;
    }
  }
  return out.filter((r) => r.length > 1);
}

/** Twice the signed area of a polyline closed back to its start: positive when it runs clockwise on screen. */
function area(pts: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

/** Paints a block's front face in its material: handed the face's path and the box around it, knobs included. */
type Tex = (path: () => void, box: Box) => void;

/**
 * A block: its top face (when given a colour) and its right face receding —
 * `side` a colour for a plain wash, or a material painted sheared along the
 * receding vector, so its courses and boards rise to the right — then its
 * front face in the material `tex` paints. `mat`: the material's plain colour,
 * for the thickness of its knobs and sockets.
 */
function piece(
  g: Ctx2D,
  r: Rnd,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tabs: Tabs,
  tex: Tex,
  topCol: string | null,
  side: string | Tex | null,
  mat: string,
): void {
  const path = () => piecePath(g, x0, y0, x1, y1, tabs);
  const box: Box = [x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD];
  if (topCol)
    oblique.fill(g, oblique.topFace(x0, x1, y0, PD), (top) =>
      wash(g, () => poly(g, top), bbox(top), topCol, r, {
        blob: 4,
        var: 14,
        shadeA: 0.14,
        lw: 1.2,
      }),
    );
  if (typeof side === "string")
    oblique.fill(g, oblique.sideFace(x1, y1, y0, PD), (face) =>
      wash(g, () => poly(g, face), bbox(face), side, r, {
        blob: 4,
        var: 14,
        shadeA: 0.3,
        lw: 1.2,
      }),
    );
  else if (side) {
    // painted flat in side-face space (its courses and boards rise to the right with it), then shaded
    const rect = () => {
      g.beginPath();
      g.rect(0, y0, PD, y1 - y0);
    };
    oblique.onSide(g, x1, () => {
      side(rect, [0, y0, PD, y1]);
      g.fillStyle = "rgba(24,20,16,.45)";
      g.fillRect(0, y0, PD, y1 - y0);
      rect();
      ink(g, 1.2);
      g.stroke();
    });
  }
  // what stands free of the block has its thickness too: a knob its top and flank, a socket its inner wall and floor
  edgesOf(x0, y0, x1, y1).forEach(([ax, ay, bx, by], i) => {
    const tab = tabs[i]!;
    if (tab === 0 || (typeof tab === "object" && tab.flush)) return;
    tabDepth(
      g,
      tabPts(ax, ay, bx, by, tab),
      mat,
      i === 0
        ? oblique.topFace(x0, x1, y0, PD)
        : i === 1
          ? oblique.sideFace(x1, y1, y0, PD)
          : null,
    );
  });
  tex(path, box);
  g.save();
  path();
  g.clip();
  streaks(
    g,
    r,
    [x0, y0, x1, y1],
    (x1 - x0) / 12,
    "40,32,24",
    0.13,
    (y1 - y0) * 0.6,
  );
  const ao = g.createLinearGradient(0, y1 - 12, 0, y1);
  ao.addColorStop(0, "rgba(30,28,18,0)");
  ao.addColorStop(1, "rgba(30,28,18,.3)");
  g.fillStyle = ao;
  g.fillRect(x0 - PAD, y1 - 12, x1 - x0 + 2 * PAD, 12 + PAD);
  g.restore();
  path();
  ink(g, 1.6);
  g.stroke();
}

/** The point `u` (0..1) of the way along a polyline. */
function along(pts: readonly Pt[], u: number): Pt {
  const ls: number[] = [];
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    ls.push(l);
    L += l;
  }
  let d = u * L;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]!;
    if (d <= l || i === ls.length - 1) {
      const k = Math.min(1, d / l);
      const a = pts[i]!;
      const b = pts[i + 1]!;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
    d -= l;
  }
  return pts[0]!;
}

/** A brass union where a pipe enters a block. */
function node(g: Ctx2D, x: number, y: number): void {
  disc(g, x, y, 5);
  g.fillStyle = BRASS;
  g.fill();
  ink(g, 1);
  g.stroke();
  disc(g, x, y, 1.9);
  g.fillStyle = BRASS_D;
  g.fill();
}

/** The painted block's colour: the app's hue as faded, greyed paint. */
const paintCol = (s: PaintState): string => mix(accent(s.hue), "#857a70", 0.3);

/** A pulse of light at (x, y), `a` its strength: a glow and a bright bead. */
function pulse(g: Ctx2D, x: number, y: number, a: number): void {
  g.save();
  g.globalCompositeOperation = "lighter";
  const pg = g.createRadialGradient(x, y, 0, x, y, 10);
  pg.addColorStop(0, `rgba(255,214,130,${0.7 * a})`);
  pg.addColorStop(1, "rgba(255,214,130,0)");
  g.fillStyle = pg;
  disc(g, x, y, 10);
  g.fill();
  g.restore();
  g.globalAlpha = a;
  disc(g, x, y, 2.6);
  g.fillStyle = "#fff0c4";
  g.fill();
  g.strokeStyle = "rgba(120,80,30,.8)";
  g.lineWidth = 0.7;
  g.stroke();
  g.globalAlpha = 1;
}

/** The upper block's edges: a knob on top, one out to the left. */
const UPPER_TABS: Tabs = [{ dir: 1, at: 0.3 }, 0, 0, 1];

export const blockWorkshop: BuildingSpec = {
  door: { kind: "leaf", w: 34, h: 60, head: 17 },
  footprint: {
    w: 236,
    depth: 80,
    ground: [-205, -112, 215, 59],
    upper: [-140, -246, 136, -112],
  },
  setting: ["forest"],
  signX: -175,
  lights: [
    [0, -32, 20],
    [-66, -50, 12],
    [94, -54, 12],
    [-88, -126, 11],
    [-52, -126, 11],
    [0, -150, 16],
    [0, -237, 11],
    [80, -123, 10],
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const A = accent(s.hue);
    const PC = paintCol(s);
    const stoneTex: Tex = (path, b) =>
      stones(g, b[0], b[1], b[2], b[3], r, {
        clip: path,
        outline: false,
        rowH: 9,
        blockW: 18,
      });
    const boardTex =
      (col: string, vertical: boolean, pw: number): Tex =>
      (path, b) => {
        g.save();
        path();
        g.clip();
        planks(g, b[0], b[1], b[2], b[3], r, { base: col, vertical, pw });
        g.restore();
      };
    const plasterTex: Tex = (path, b) =>
      wash(g, path, b, "#cdc1a4", r, {
        blob: 9,
        var: 20,
        shadeA: 0.2,
        outline: false,
      });
    castShadow(
      g,
      [
        [-112, 4],
        [124, 4],
        [184, 28],
        [196, -4],
        [140, -14],
      ],
      0.28,
    );
    // the three ground blocks, tenoned into one another: painted boards, oak boards with the door, coursed stone
    piece(
      g,
      r,
      42,
      -96,
      118,
      0,
      [-1, 1, 0, 0],
      boardTex(PC, false, 8),
      mix(PC, "#6c6f73", 0.5),
      boardTex(PC, false, 8),
      PC,
    );
    piece(
      g,
      r,
      -42,
      -96,
      42,
      0,
      [0, { dir: 1, at: 0.68, flush: true }, 0, 0],
      boardTex("#8a7253", true, 8),
      "#7a6a52",
      null,
      "#8a7253",
    );
    // the upper block: lime plaster in an oak frame
    piece(
      g,
      r,
      UP[0],
      UP[1],
      UP[2],
      UP[3],
      UPPER_TABS,
      plasterTex,
      "#8d8676",
      "#857a62",
      "#cdc1a4",
    );
    g.save();
    piecePath(g, UP[0], UP[1], UP[2], UP[3], UPPER_TABS);
    g.clip();
    for (const [a, b, c, d] of [
      [UP[0], UP[1] + 2, UP[2], UP[1] + 2],
      [UP[0], UP[3] - 2, UP[2], UP[3] - 2],
      [UP[0] + 2, UP[1], UP[0] + 2, UP[3]],
      [UP[2] - 2, UP[1], UP[2] - 2, UP[3]],
      [-65, UP[1], -65, UP[3]],
    ] as const) {
      seg(g, a, b, c, d);
      bar(g, 3.6, "#6a563c", "rgba(255,240,210,.2)");
    }
    g.restore();
    piece(
      g,
      r,
      -118,
      -96,
      -42,
      0,
      [0, { dir: 1, at: 0.57, flush: true }, 0, { dir: 1, at: 0.4 }],
      stoneTex,
      null,
      null,
      "#aaa392",
    );
    windowRect(g, -78, -36, 22, 30, r, { arch: true, lit, sill: "#a49d8c" });
    windowRect(g, 84, -42, 20, 26, r, { lit, frame: "#4a3a2c" });
    windowRect(g, -96, -112, 16, 28, r, { arch: true, lit, frame: "#4a3a2c" });
    windowRect(g, -58, -112, 16, 28, r, { arch: true, lit, frame: "#4a3a2c" });
    doorArch(g, 0, 0, 34, 60, r, { col: A });
    steps(g, 0, 2, 38, 1, r);
    lantern(g, -30, -54, lit);
    lantern(g, 30, -54, lit);
    // the mast the crane and the hub hang on, and the copper pipes that run from the hub to every block
    seg(g, 0, -102, 0, MAST + 4);
    bar(g, 6, "#7d6648", "rgba(255,240,210,.25)");
    seg(g, 0, JIB[1], JIB[0] + 6, JIB[1]);
    bar(g, 5, "#7d6648", "rgba(255,240,210,.25)");
    seg(g, 0, -186, 38, JIB[1]);
    bar(g, 3, "#6a563c", null);
    seg(g, 0, MAST + 6, JIB[0], JIB[1] - 3);
    bar(g, 1, IRON, null);
    disc(g, JIB[0], JIB[1] + 4, 4.4);
    g.fillStyle = BRASS_D;
    g.fill();
    ink(g, 1);
    g.stroke();
    const blockPipes = PIPES.slice(0, 4);
    for (const p of blockPipes) {
      g.beginPath();
      p.forEach(([x, y], i) => {
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      bar(g, 2.8, COPPER, "rgba(255,226,190,.4)");
    }
    for (const p of blockPipes) {
      const end = p[p.length - 1]!;
      node(g, end[0], end[1]);
    }
    // the hub: a brass wheel of six lugs
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + 0.52;
      const lx = HUB[0] + Math.cos(a) * 20;
      const ly = HUB[1] + Math.sin(a) * 20;
      seg(g, HUB[0], HUB[1], lx, ly);
      bar(g, 2.6, BRASS_D, null);
      disc(g, lx, ly, 3.8);
      g.fillStyle = BRASS;
      g.fill();
      ink(g, 0.9);
      g.stroke();
    }
    wash(
      g,
      () => disc(g, HUB[0], HUB[1], 12.5),
      [HUB[0] - 13, HUB[1] - 13, HUB[0] + 13, HUB[1] + 13],
      BRASS,
      r,
      {
        blob: 3,
        var: 26,
        shadeA: 0.3,
        lw: 1.3,
      },
    );
    disc(g, HUB[0], HUB[1], 5.6);
    g.fillStyle = lit ? "#ffd98a" : "#d9c9a0";
    g.fill();
    ink(g, 0.9);
    g.stroke();
    disc(g, 0, MAST - 5, 5.4);
    g.fillStyle = lit ? "#ffe2a0" : "#c9d2cc";
    g.fill();
    ink(g, 1);
    g.stroke();
    g.fillStyle = BRASS_D;
    g.fillRect(-3.5, MAST - 0.5, 7, 3.5);
    // the lens's bracket; a spare block and crates on the grass
    disc(g, PIV[0], PIV[1], 4);
    g.fillStyle = BRASS_D;
    g.fill();
    ink(g, 1);
    g.stroke();
    g.save();
    g.translate(166, 42);
    g.rotate(-0.06);
    castShadow(
      g,
      [
        [-17, 0],
        [20, 0],
        [36, 9],
        [-2, 9],
      ],
      0.3,
    );
    g.scale(0.62, 0.62);
    piece(
      g,
      r,
      -28,
      -44,
      28,
      0,
      [1, 0, 0, -1],
      stoneTex,
      "#8d8676",
      stoneTex,
      "#aaa392",
    );
    g.restore();
    crate(g, -178, 26, 19, r);
    crate(g, -170, 7, 15, r);
    ivy(g, -113, -2, -78, r, 16);
    moss(g, -118, 118, 1, r, 20);
    tufts(g, -124, 132, 3, r, 30);
    for (const [x, y, z, k] of [
      [-186, 44, 11, 1],
      [190, 4, 12, 0],
      [-64, 40, 9, 2],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    const lit = s.night;
    // the copper block is repainted every frame: a fixed stream, so its patina never shimmers
    const r = parkMiller(31);
    // the crane lifts the copper block out of its socket, holds it, and slots it back
    const c = t % 34;
    const lift = 27 * (ss(3, 9, c) - ss(18, 24, c));
    const ex = Math.sin(t * 0.9) * 1.1 * Math.min(1, lift / 8);
    const ey = -lift;
    g.strokeStyle = "rgba(60,48,34,.9)";
    g.lineWidth = 1.2;
    seg(g, JIB[0], JIB[1] + 6, EM + ex, EY0 - 4 + ey);
    g.stroke();
    // the cord from the hub to it, taking up the slack
    const cord = [
      [HUB[0] + 12, HUB[1] + 4],
      [34, -102 + ey * 0.4],
      [EX0 + 4 + ex, -126 + ey],
    ] as const;
    g.beginPath();
    g.moveTo(cord[0][0], cord[0][1]);
    g.quadraticCurveTo(cord[1][0], cord[1][1], cord[2][0], cord[2][1]);
    g.strokeStyle = INK;
    g.lineWidth = 3.4;
    g.lineCap = "round";
    g.stroke();
    g.strokeStyle = "#6f5a44";
    g.lineWidth = 1.8;
    g.stroke();
    g.save();
    g.translate(ex, ey);
    g.lineJoin = "round";
    poly(g, oblique.topFace(EX0, EX1, EY0, PD));
    g.fillStyle = "#86a596";
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1.2;
    g.stroke();
    poly(g, oblique.sideFace(EX1, EY1, EY0, PD));
    g.fillStyle = "#3f5a50";
    g.fill();
    g.stroke();
    // its knob's thickness, as much of it as has come up out of the socket
    for (const run of above(tabPts(EX1, EY1, EX0, EY1, 1), EY1 + lift - 0.5))
      oblique.paintRim(g, oblique.rim(run, PD), (up) =>
        mix("#3f5a50", "#86a596", up),
      );
    const ep = () => piecePath(g, EX0, EY0, EX1, EY1, [0, 0, 1, 0]);
    g.save();
    ep();
    g.clip();
    const eg = g.createLinearGradient(EX0, EY0, EX1, EY1 + 20);
    eg.addColorStop(0, "#86a999");
    eg.addColorStop(0.5, "#6f9586");
    eg.addColorStop(1, "#4d7064");
    g.fillStyle = eg;
    g.fillRect(EX0 - 4, EY0 - 2, EX1 - EX0 + 8, EY1 - EY0 + PAD + 2);
    for (let i = 0; i < 34; i++) {
      g.fillStyle =
        r() < 0.3
          ? `rgba(150,100,62,${0.14 + r() * 0.16})`
          : `rgba(${r() < 0.5 ? "150,190,170" : "60,90,78"},${0.14 + r() * 0.16})`;
      g.beginPath();
      g.ellipse(
        EX0 + r() * (EX1 - EX0),
        EY0 + r() * (EY1 - EY0 + 20),
        3 + r() * 7,
        2 + r() * 4,
        r() * 3,
        0,
        TAU,
      );
      g.fill();
    }
    g.strokeStyle = "rgba(30,44,38,.45)";
    g.lineWidth = 0.9;
    for (const x of [EX0 + 18.5, EX0 + 37.5]) {
      seg(g, x, EY0, x, EY1);
      g.stroke();
    }
    for (let y = EY0 + 5; y < EY1 - 2; y += 8)
      for (const x of [2.5, 16, 21, 35, 40, 52]) rivet(g, EX0 + x, y, 0.8);
    g.restore();
    ep();
    g.strokeStyle = INK;
    g.lineWidth = 1.6;
    g.stroke();
    disc(g, EM, -123, 9.6);
    g.fillStyle = BRASS_D;
    g.fill();
    g.lineWidth = 1;
    g.stroke();
    disc(g, EM, -123, 7);
    g.fillStyle = lit ? "#f0b860" : "#56646a";
    g.fill();
    g.stroke();
    g.strokeStyle = IRON;
    g.lineWidth = 1.8;
    g.beginPath();
    g.arc(EM, EY0 - 3, 3, 0, TAU);
    g.stroke();
    node(g, EX0 + 4, -126);
    g.restore();
    // pulses of light running from the hub out along every pipe, and up to the lamp
    PIPES.forEach((p, i) => {
      const u = ((t + i * 2.9) % 8.5) / 4;
      if (u < 1) {
        const [x, y] = along(p, u);
        pulse(g, x, y, Math.min(1, u * 6, (1 - u) * 6));
      }
    });
    {
      const u = ((t + 5.3) % 8.5) / 4;
      if (u < 1) {
        const q = 1 - u;
        pulse(
          g,
          q * q * cord[0][0] + 2 * q * u * cord[1][0] + u * u * cord[2][0],
          q * q * cord[0][1] + 2 * q * u * cord[1][1] + u * u * cord[2][1],
          Math.min(1, u * 6, (1 - u) * 6),
        );
      }
    }
    glowPane(g, s, HUB[0], HUB[1], 5.6, null, 0.6);
    glowPane(g, s, 0, MAST - 5, 5.4, null, 3.1);
    glowPane(g, s, -94, -138, 12, 24, 1.7);
    // the inspector's lens on its brass arm, sweeping the stonework and dwelling
    const a =
      0.62 +
      0.36 * Math.tanh(2.2 * Math.sin(t * 0.19)) +
      0.03 * Math.sin(t * 0.9);
    const lx = PIV[0] + Math.sin(a) * ARM;
    const ly = PIV[1] + Math.cos(a) * ARM;
    seg(g, PIV[0], PIV[1], lx - Math.sin(a) * LR, ly - Math.cos(a) * LR);
    bar(g, 2.6, BRASS, BRASS_L);
    g.save();
    disc(g, lx, ly, LR);
    g.clip();
    g.fillStyle = "#6c6557";
    g.fillRect(lx - LR, ly - LR, 2 * LR, 2 * LR);
    // the masonry under the glass, enlarged
    const Z = 1.8;
    for (
      let j = Math.floor((ly - LR / Z) / 9) - 1;
      j <= Math.ceil((ly + LR / Z) / 9);
      j++
    ) {
      const y = ly + (j * 9 - ly) * Z;
      for (
        let i = Math.floor((lx - LR / Z) / 18) - 1;
        i <= Math.ceil((lx + LR / Z) / 18);
        i++
      ) {
        const x = lx + (i * 18 + (j & 1) * 9 - lx) * Z;
        g.fillStyle = (i + j) & 1 ? "#c4bdab" : "#b2ab99";
        g.beginPath();
        g.roundRect(x + 1.2, y + 1.2, 18 * Z - 2.4, 9 * Z - 2.4, 3);
        g.fill();
      }
    }
    const lg = g.createRadialGradient(lx - 5, ly - 6, 1, lx, ly, LR);
    lg.addColorStop(0, "rgba(240,250,250,.5)");
    lg.addColorStop(0.6, "rgba(200,225,225,.12)");
    lg.addColorStop(1, "rgba(60,90,90,.3)");
    g.fillStyle = lg;
    g.fillRect(lx - LR, ly - LR, 2 * LR, 2 * LR);
    g.restore();
    disc(g, lx, ly, LR + 1.4);
    bar(g, 3, BRASS, BRASS_L);
  },
};
