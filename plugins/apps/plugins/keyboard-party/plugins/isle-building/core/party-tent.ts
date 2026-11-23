// Keyboard Party's building on Isle: the party tent — a round canvas big top in
// faded red and cream stripes, patched and stained, with a scalloped valance,
// guy ropes and pegs, a pennant on the king pole and a bunch of balloons tied
// at each side. Three giant keycaps of painted boards (A, S, D) sit in sockets
// by the entrance: on each beat one goes down and springs back with a puff of
// paper bits, and the bell in the doorway rings.

import {
  accent,
  castShadow,
  dark,
  fittings,
  grain,
  hline,
  ink,
  jit,
  light,
  mix,
  moss,
  oblique,
  poly,
  shrub,
  tufts,
  wash,
  type Box,
  type BuildingSpec,
  type Ctx2D,
  type Pt,
} from "@plugins/apps/plugins/isle/plugins/buildings/core";

const {
  TAU,
  INK,
  BRASS,
  BRASS_D,
  disc,
  seg,
  bar,
  streaks,
  ellShadow,
  gust,
  cloth,
} = fittings;

const GRAIN_BOX: Box = [-200, -280, 200, 62];
const RED = "#a45a4a";
const CREAM = "#d8ccb0";

// The big top: a round canvas wall (radius R, its foot an ellipse round
// (0, BY)), the eave above it, the peak.
const R = 96;
const RYW = 22;
const BY = -22;
const WH = 78;
const EY = BY - WH;
const RE = 104;
const RYE = 25;
const AY = -226;
/** Stripes round the front half. */
const STRIPES = 14;

/** A point of the eave: `a` runs 0 (its left end) … π (its right end), round the front. */
const eave = (a: number): Pt => [-Math.cos(a) * RE, EY + Math.sin(a) * RYE];

/** Continues the path along a roof seam, sagging: peak → eave point `a`, or back up to the peak. */
function roofEdge(g: Ctx2D, a: number, back = false): void {
  const [x, y] = eave(a);
  if (back) g.quadraticCurveTo(x * 0.5, (AY + y) / 2 + 12, 0, AY);
  else g.quadraticCurveTo(x * 0.5, (AY + y) / 2 + 12, x, y);
}

function wallPath(g: Ctx2D): void {
  g.beginPath();
  g.moveTo(-R, EY);
  g.lineTo(R, EY);
  g.lineTo(R, BY);
  g.ellipse(0, BY, R, RYW, 0, 0, Math.PI);
  g.closePath();
}

function roofPath(g: Ctx2D): void {
  g.beginPath();
  g.moveTo(0, AY);
  roofEdge(g, 0);
  g.ellipse(0, EY, RE, RYE, 0, Math.PI, 0, true);
  roofEdge(g, Math.PI, true);
  g.closePath();
}

function doorPath(g: Ctx2D): void {
  g.beginPath();
  g.moveTo(-18, 0);
  g.lineTo(-18, -40);
  g.quadraticCurveTo(-16, -58, 0, -60);
  g.quadraticCurveTo(16, -58, 18, -40);
  g.lineTo(18, 0);
  g.closePath();
}

/** Guy ropes: side, the peg's x and y, where on the eave the rope starts. */
const PEGS = [
  [-1, 138, -6, 0],
  [-1, 126, 24, 0.5],
  [1, 138, -6, 0],
  [1, 126, 24, 0.5],
] as const;
/** The balloon stakes: x, y, the phase of their wind. */
const BUNCHES = [
  [-146, 4, 0.3],
  [150, 6, 2.2],
] as const;
/** Balloon colours (null: the app's). */
const BALLOONS: readonly (string | null)[] = [
  "#a45a4a",
  "#c2a04e",
  "#7f9a86",
  "#7c8ea6",
  null,
];

interface Key {
  readonly x: number;
  /** Its socket's foot. */
  readonly y: number;
  readonly letter: string;
  /** Its paint (null: the app's colour, faded). */
  readonly col: string | null;
  readonly seed: number;
}
/** The three keys by the entrance. */
const KEYS: readonly Key[] = [
  { x: -78, y: 26, letter: "A", col: "#8c987a", seed: 11 },
  { x: -40, y: 44, letter: "S", col: null, seed: 23 },
  { x: 64, y: 36, letter: "D", col: "#8191a0", seed: 37 },
];
const KEY_W = 40;
const KEY_H = 30;
/** How deep a key (and its socket) is. */
const KEY_D = 8;
/** How far a key rides above its socket, and how far it goes down. */
const LIFT = 5;
const DIP = 4.5;
/** Seconds a beat. */
const BEAT = 1.5;
/** Which key goes down on each beat (-1: a rest). */
const SEQ: readonly number[] = [0, 2, 1, -1, 2, 0, -1, 1, 0, 1, 2, -1];
const PAPER = ["#c9b27a", "#b0664c", "#8b9878", "#8090a0", "#d9cfb4"] as const;

/**
 * A fixed stream for what is drawn every frame (the keys, their paper bits):
 * the same blotches each time. (`PaintState.rnd` is the paint's stream; a
 * frame must not draw from it.)
 */
function fixedStream(seed: number): () => number {
  let v = seed;
  return () => {
    v = (Math.imul(v, 1664525) + 1013904223) | 0;
    return (v >>> 8) / 16777216;
  };
}

function path(g: Ctx2D, pts: readonly Pt[]): void {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

/** One keycap, its foot at (0, 0): a tapered block of painted boards with a dished top and a stencilled letter. */
function cap(
  g: Ctx2D,
  w: number,
  h: number,
  col: string,
  letter: string,
  seed: number,
): void {
  const q = fixedStream(seed);
  const hw = w / 2;
  const tw = hw - 5;
  const front: Pt[] = [
    [-hw, 0],
    [hw, 0],
    [tw, -h],
    [-tw, -h],
  ];
  g.lineJoin = "round";
  g.strokeStyle = INK;
  g.lineWidth = 1.3;
  // its right side (the front's sloping edge going back) and its top, the dish in it
  oblique.fill(g, oblique.extrude([hw, 0], [tw, -h], KEY_D), (side) => {
    path(g, side);
    g.fillStyle = dark(col, 0.4);
    g.fill();
    g.stroke();
  });
  oblique.fill(g, oblique.topFace(-tw, tw, -h, KEY_D), (top) => {
    path(g, top);
    g.fillStyle = light(col, 0.26);
    g.fill();
    g.stroke();
  });
  oblique.onTop(g, -h, () => {
    g.beginPath();
    g.rect(-tw + 3.5, 1.6, 2 * tw - 7, KEY_D - 3.2);
    g.fillStyle = dark(col, 0.12);
    g.fill();
    g.strokeStyle = "rgba(48,38,28,.4)";
    g.lineWidth = 0.7;
    g.stroke();
  });
  g.save();
  path(g, front);
  g.fillStyle = col;
  g.fill();
  g.clip();
  for (let i = 0; i < 20; i++) {
    const k = q();
    g.fillStyle =
      k < 0.4
        ? `rgba(60,48,34,${0.07 + q() * 0.1})`
        : k < 0.75
          ? `rgba(255,246,222,${0.07 + q() * 0.1})`
          : `rgba(140,112,78,${0.1 + q() * 0.12})`;
    g.beginPath();
    g.ellipse(
      -hw + q() * w,
      -q() * h,
      3 + q() * 8,
      2 + q() * 4,
      q() * 3,
      0,
      TAU,
    );
    g.fill();
  }
  g.strokeStyle = "rgba(48,38,28,.3)";
  g.lineWidth = 0.7;
  for (let x = -hw + 8; x < hw; x += 8) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo((x / hw) * tw + (q() - 0.5), -h);
    g.stroke();
  }
  for (let i = 0; i < 4; i++) {
    const x = -hw + q() * w;
    g.strokeStyle = `rgba(50,42,30,${0.1 + q() * 0.1})`;
    g.lineWidth = 1.5 + q() * 2.5;
    g.beginPath();
    g.moveTo(x, -h + q() * 8);
    g.lineTo(x + q() * 2, -h + 10 + q() * 16);
    g.stroke();
  }
  const gr = g.createLinearGradient(-hw, -h, hw, 0);
  gr.addColorStop(0, "rgba(255,248,230,.14)");
  gr.addColorStop(0.5, "rgba(0,0,0,0)");
  gr.addColorStop(1, "rgba(30,26,20,.24)");
  g.fillStyle = gr;
  g.fillRect(-hw, -h, w, h);
  g.fillStyle = "rgba(255,250,236,.3)";
  g.fillRect(-hw, -h, w, 1.6);
  // the legend, stencilled and worn
  g.font = `700 ${Math.round(h * 0.72)}px Georgia, serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(50,38,28,.7)";
  g.fillText(letter, 0, -h * 0.46);
  for (let i = 0; i < 12; i++) {
    g.fillStyle = light(col, 0.05, 0.75);
    g.fillRect(
      -9 + q() * 18,
      -h * 0.46 - 10 + q() * 20,
      1 + q() * 2.4,
      0.8 + q() * 1.6,
    );
  }
  g.restore();
  path(g, front);
  g.strokeStyle = INK;
  g.lineWidth = 1.4;
  g.stroke();
}

interface Press {
  /** How far down the key is: 0 up … 1 down (a little under 0 as it springs back). */
  readonly p: number;
  /** Seconds since it bottomed on this beat, or -1 when it is not this beat's key. */
  readonly tau: number;
  readonly beat: number;
}

/** Key `k` at time `t`. */
function pressOf(k: number, t: number): Press {
  const c = t / BEAT;
  const beat = Math.floor(c);
  const f = c - beat;
  const hit = SEQ[((beat % SEQ.length) + SEQ.length) % SEQ.length] === k;
  const p = !hit
    ? 0
    : f < 0.09
      ? f / 0.09
      : f < 0.26
        ? 1
        : f < 0.4
          ? 1 - (f - 0.26) / 0.14
          : f < 0.62
            ? -0.1 * Math.sin(((f - 0.4) / 0.22) * Math.PI)
            : 0;
  return { p, tau: hit ? (f - 0.09) * BEAT : -1, beat };
}

/** Canvas weathering inside the current clip: sun-bleached, grimy and green blotches over `box`. */
function weather(
  g: Ctx2D,
  r: () => number,
  box: Box,
  n: number,
  rx: number,
  ry: number,
  turn: boolean,
): void {
  const [x0, y0, x1, y1] = box;
  for (let i = 0; i < n; i++) {
    const k = r();
    g.fillStyle =
      k < 0.45
        ? `rgba(236,226,200,${0.08 + r() * 0.12})`
        : k < 0.8
          ? `rgba(90,70,50,${0.06 + r() * 0.1})`
          : `rgba(110,124,84,${0.08 + r() * 0.1})`;
    g.beginPath();
    g.ellipse(
      x0 + r() * (x1 - x0),
      y0 + r() * (y1 - y0),
      3 + r() * rx,
      3 + r() * ry,
      turn ? r() * 3 : 0,
      0,
      TAU,
    );
    g.fill();
  }
}

/** A sewn-on canvas patch over `pts`. */
function patch(g: Ctx2D, r: () => number, pts: readonly Pt[]): void {
  g.fillStyle = jit("#c4b592", r, 12);
  poly(g, pts);
  g.fill();
  g.strokeStyle = "rgba(48,38,28,.6)";
  g.lineWidth = 0.7;
  g.setLineDash([2, 1.6]);
  g.stroke();
  g.setLineDash([]);
}

export const partyTent: BuildingSpec = {
  door: { kind: "opening", w: 36, h: 60 },
  footprint: {
    w: 192,
    depth: 44,
    ground: [-176, -112, 192, 52],
    upper: [-118, -262, 110, -112],
  },
  setting: ["lane", "square"],
  signX: -172,
  lights: [
    [0, -28, 22],
    [-60, -52, 12],
    [60, -52, 12],
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const A = accent(s.hue);
    castShadow(
      g,
      [
        [-90, 2],
        [96, 2],
        [150, 20],
        [176, 2],
        [150, -36],
        [104, -30],
      ],
      0.26,
    );
    // trodden straw at the entrance: a thin wash, kept (stacked) under what counts as the building, so hover does not outline it
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(214,190,118,${0.03 + r() * 0.035})`;
      g.beginPath();
      g.ellipse(
        (r() - 0.5) * 110,
        12 + r() * 30,
        8 + r() * 16,
        2 + r() * 4,
        0,
        0,
        TAU,
      );
      g.fill();
    }
    // the wall: canvas in broad faded stripes, hanging in folds from the eave
    const wallBox: Box = [-R, EY, R, 0];
    wash(g, () => wallPath(g), wallBox, CREAM, r, {
      var: 18,
      blob: 12,
      outline: false,
      shade: false,
    });
    g.save();
    wallPath(g);
    g.clip();
    for (let i = 0; i < STRIPES; i++) {
      const x0 = -Math.cos((i * Math.PI) / STRIPES) * R;
      const x1 = -Math.cos(((i + 1) * Math.PI) / STRIPES) * R;
      if (i % 2 === 0) {
        g.fillStyle = jit(RED, r, 14, 0.9);
        g.fillRect(x0, EY, x1 - x0, WH + RYW + 2);
      }
      const fold = g.createLinearGradient(x0, 0, x1, 0);
      fold.addColorStop(0, "rgba(40,30,22,.2)");
      fold.addColorStop(0.3, "rgba(40,30,22,0)");
      fold.addColorStop(0.8, "rgba(255,250,236,.1)");
      fold.addColorStop(1, "rgba(40,30,22,.12)");
      g.fillStyle = fold;
      g.fillRect(x0, EY, x1 - x0, WH + RYW + 2);
      ink(g, 0.6, 0.35);
      hline(g, x0, EY, x0, BY + RYW, r, 1);
    }
    weather(g, r, [-R, EY, R, EY + WH + RYW], 90, 7, 14, false);
    streaks(g, r, wallBox, 26, "70,58,44", 0.12, 46);
    const mud = g.createLinearGradient(0, -22, 0, 2);
    mud.addColorStop(0, "rgba(96,86,56,0)");
    mud.addColorStop(1, "rgba(96,86,56,.42)");
    g.fillStyle = mud;
    g.fillRect(-R, -44, 2 * R, 46);
    const round = g.createLinearGradient(-R, 0, R, 0);
    round.addColorStop(0, "rgba(255,248,230,.12)");
    round.addColorStop(0.45, "rgba(0,0,0,0)");
    round.addColorStop(1, "rgba(26,22,18,.36)");
    g.fillStyle = round;
    g.fillRect(-R, EY, 2 * R, WH + RYW + 2);
    // the eave's shadow on the wall: it follows the round eave, and thins out downwards
    for (const [drop, a] of [
      [6, 0.14],
      [11, 0.1],
      [16, 0.08],
    ] as const) {
      g.fillStyle = `rgba(26,22,18,${a})`;
      g.beginPath();
      g.moveTo(-R, EY);
      g.lineTo(R, EY);
      g.ellipse(0, EY + drop, R, RYE, 0, 0, Math.PI);
      g.closePath();
      g.fill();
    }
    // patches, sewn on
    for (const [x, y, w, h, a] of [
      [-70, -52, 15, 12, 0.08],
      [48, -34, 13, 16, -0.06],
    ] as const) {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      patch(g, r, [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ]);
      g.restore();
    }
    g.restore();
    wallPath(g);
    ink(g, 1.5);
    g.stroke();
    // the doorway: the flaps tied back on a dark inside
    doorPath(g);
    const inside = g.createLinearGradient(0, -60, 0, 0);
    if (lit) {
      inside.addColorStop(0, "#c98a45");
      inside.addColorStop(1, "#f2c879");
    } else {
      inside.addColorStop(0, "#1f1a17");
      inside.addColorStop(1, "#3a2f27");
    }
    g.fillStyle = inside;
    g.fill();
    ink(g, 1.4);
    g.stroke();
    for (const k of [-1, 1]) {
      const flap = () => {
        g.beginPath();
        g.moveTo(k * 2, -60);
        g.quadraticCurveTo(k * 21, -52, k * 23, -30);
        g.lineTo(k * 29, -1);
        g.lineTo(k * 18, 0);
        g.quadraticCurveTo(k * 15, -22, k * 17, -38);
        g.quadraticCurveTo(k * 15, -54, k * 2, -60);
        g.closePath();
      };
      wash(
        g,
        flap,
        k < 0 ? [-29, -60, -2, 0] : [2, -60, 29, 0],
        light(CREAM, 0.12),
        r,
        { blob: 4, var: 16, lw: 1.2, shadeA: 0.2 },
      );
      ink(g, 0.6, 0.4);
      hline(g, k * 20, -44, k * 24, -6, r, 0.8);
      hline(g, k * 16, -50, k * 20, -24, r, 0.8);
      seg(g, k * 16, -32, k * 25, -30);
      bar(g, 1.4, "#8a7250", null);
    }
    // the roof: the same canvas, its stripes running to the peak, sagging between the seams
    const roofBox: Box = [-RE, AY, RE, EY + RYE];
    wash(g, () => roofPath(g), roofBox, CREAM, r, {
      var: 18,
      blob: 12,
      outline: false,
      shade: false,
    });
    g.save();
    roofPath(g);
    g.clip();
    for (let i = 0; i < STRIPES; i++) {
      const a0 = (i * Math.PI) / STRIPES;
      const a1 = ((i + 1) * Math.PI) / STRIPES;
      const p1 = eave(a1);
      if (i % 2 === 0) {
        g.beginPath();
        g.moveTo(0, AY);
        roofEdge(g, a0);
        g.lineTo(p1[0], p1[1] + 4);
        roofEdge(g, a1, true);
        g.closePath();
        g.fillStyle = jit(RED, r, 14, 0.9);
        g.fill();
      }
      g.beginPath();
      g.moveTo(0, AY);
      roofEdge(g, a0);
      ink(g, 0.7, 0.4);
      g.stroke();
    }
    weather(g, r, roofBox, 110, 10, 8, true);
    streaks(g, r, roofBox, 24, "70,58,44", 0.11, 50);
    const slope = g.createLinearGradient(-RE, 0, RE, 0);
    slope.addColorStop(0, "rgba(255,248,230,.14)");
    slope.addColorStop(0.45, "rgba(0,0,0,0)");
    slope.addColorStop(1, "rgba(26,22,18,.38)");
    g.fillStyle = slope;
    g.fillRect(-RE, AY, 2 * RE, EY + RYE - AY);
    patch(g, r, [
      [-34, -150],
      [-18, -152],
      [-15, -136],
      [-33, -134],
    ]);
    g.restore();
    roofPath(g);
    ink(g, 1.6);
    g.stroke();
    // the scalloped valance round the eave, a faded band of the app's colour above it
    const SCALLOPS = 26;
    for (let j = 0; j < SCALLOPS; j++) {
      const p0 = eave((j * Math.PI) / SCALLOPS);
      const p1 = eave(((j + 1) * Math.PI) / SCALLOPS);
      g.beginPath();
      g.moveTo(p0[0], p0[1] - 1);
      g.lineTo(p1[0], p1[1] - 1);
      g.lineTo(p1[0], p1[1] + 5);
      g.quadraticCurveTo(
        (p0[0] + p1[0]) / 2,
        (p0[1] + p1[1]) / 2 + 17,
        p0[0],
        p0[1] + 5,
      );
      g.closePath();
      g.fillStyle = jit(j % 2 ? RED : CREAM, r, 14);
      g.fill();
      ink(g, 0.9, 0.8);
      g.stroke();
    }
    g.beginPath();
    g.ellipse(0, EY, RE, RYE, 0, 0.02, Math.PI - 0.02);
    g.strokeStyle = "rgba(48,38,28,.85)";
    g.lineWidth = 5;
    g.stroke();
    g.strokeStyle = mix(A, "#b08a80", 0.25);
    g.lineWidth = 3.2;
    g.stroke();
    // the king pole through the peak
    g.fillStyle = "#b9ad90";
    g.beginPath();
    g.ellipse(0, AY + 3, 7, 3, 0, 0, TAU);
    g.fill();
    ink(g, 1);
    g.stroke();
    seg(g, 0, AY + 2, 0, AY - 30);
    bar(g, 2.6, "#7a6548", "rgba(255,240,210,.3)");
    disc(g, 0, AY - 32, 2.6);
    g.fillStyle = BRASS;
    g.fill();
    ink(g, 0.8);
    g.stroke();
    // guy ropes and pegs
    for (const [k, x, y, e] of PEGS) {
      const p = eave(k < 0 ? e : Math.PI - e);
      g.strokeStyle = "rgba(48,38,28,.8)";
      g.lineWidth = 1.5;
      seg(g, p[0], p[1] + 3, k * x, y - 3);
      g.stroke();
      g.strokeStyle = "rgba(214,200,160,.9)";
      g.lineWidth = 0.7;
      g.stroke();
      ellShadow(g, k * x + 4, y + 1, 5, 1.6, 0.23);
      g.save();
      g.translate(k * x, y);
      g.rotate(k * 0.3);
      g.fillStyle = jit("#8a7253", r, 16);
      g.fillRect(-2, -9, 4, 10);
      ink(g, 0.9, 0.8);
      g.strokeRect(-2, -9, 4, 10);
      g.restore();
    }
    // the stakes the balloons are tied to
    for (const [x, y] of BUNCHES) {
      ellShadow(g, x + 4, y + 1, 5, 1.6, 0.23);
      g.fillStyle = jit("#8a7253", r, 16);
      g.fillRect(x - 2, y - 12, 4, 13);
      ink(g, 0.9, 0.8);
      g.strokeRect(x - 2, y - 12, 4, 13);
    }
    // the sockets the three keys ride in (the keys themselves move)
    for (const { x, y } of KEYS) {
      ellShadow(g, x + 6, y + 1, KEY_W * 0.62, 5, 0.23);
      g.fillStyle = "#3a2f27";
      g.fillRect(x - KEY_W / 2 + 4, y - LIFT - 1, KEY_W - 8, LIFT + 2);
      ink(g, 1);
      g.strokeRect(x - KEY_W / 2 + 4, y - LIFT - 1, KEY_W - 8, LIFT + 2);
      oblique.fill(
        g,
        oblique.sideFace(x + KEY_W / 2 - 4, y + 1, y - LIFT - 1, KEY_D),
        (side) => {
          g.fillStyle = "#2a221c";
          poly(g, side);
          g.fill();
          ink(g, 1);
          g.stroke();
        },
      );
    }
    moss(g, -90, 90, 1, r, 10);
    tufts(g, -100, -22, 3, r, 9);
    tufts(g, 22, 104, 3, r, 9);
    tufts(g, -170, -110, 16, r, 6);
    tufts(g, 112, 170, 18, r, 6);
    for (const [x, y, z, k] of [
      [-118, -14, 13, 0],
      [118, -12, 13, 1],
      [108, 40, 8, 2],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    const A = accent(s.hue);
    const presses = KEYS.map((_, k) => pressOf(k, t));
    // the pennant on the king pole
    cloth(g, 1.5, AY - 29, 24, 12, t, 0.4, mix(A, "#a0706a", 0.2));
    // the bell in the doorway rings for every key
    let strike = 0;
    for (const k of presses)
      if (k.tau >= 0) strike = Math.exp(-k.tau * 2.2) * Math.sin(k.tau * 15);
    g.save();
    g.translate(0, -59);
    g.rotate(strike * 0.5);
    g.strokeStyle = INK;
    g.lineWidth = 1;
    seg(g, 0, 0, 0, 4);
    g.stroke();
    g.beginPath();
    g.moveTo(-1.8, 4);
    g.quadraticCurveTo(-2.2, 11, -6.4, 15);
    g.lineTo(6.4, 15);
    g.quadraticCurveTo(2.2, 11, 1.8, 4);
    g.closePath();
    g.fillStyle = BRASS;
    g.fill();
    g.lineWidth = 0.9;
    g.stroke();
    g.fillStyle = BRASS_D;
    g.fillRect(-1.2, 15, 2.4, 2.6);
    g.restore();
    // balloons on their strings, leaning with the wind
    BUNCHES.forEach(([bx, by, ph], b) => {
      const wind = gust(t, ph);
      const flock = [0, 1, 2, 3, 4].map((i) => {
        const ang =
          (i - 2) * 0.17 +
          (b ? -0.1 : 0.1) +
          0.16 * (wind - 0.4) +
          0.05 * Math.sin(t * 1.1 + i * 1.9 + ph);
        const len = 58 + ((i * 37) % 5) * 7;
        return {
          i,
          x: bx + Math.sin(ang) * len,
          y: by - 12 - Math.cos(ang) * len,
        };
      });
      flock.sort((p, q) => p.y - q.y);
      for (const { i, x, y } of flock) {
        g.strokeStyle = "rgba(48,38,28,.6)";
        g.lineWidth = 0.7;
        g.beginPath();
        g.moveTo(bx, by - 12);
        g.quadraticCurveTo(
          (bx + x) / 2 + 3 * Math.sin(t * 0.8 + i),
          (by - 12 + y) / 2 + 6,
          x,
          y + 11,
        );
        g.stroke();
        const col = BALLOONS[i] ?? mix(A, "#b08a80", 0.2);
        g.beginPath();
        g.ellipse(x, y, 8.5, 10.5, 0, 0, TAU);
        g.fillStyle = col;
        g.fill();
        g.strokeStyle = INK;
        g.lineWidth = 1;
        g.stroke();
        g.fillStyle = "rgba(30,24,18,.16)";
        g.beginPath();
        g.ellipse(x + 2.4, y + 2.6, 5.4, 7, 0, 0, TAU);
        g.fill();
        g.fillStyle = "rgba(255,250,236,.4)";
        g.beginPath();
        g.ellipse(x - 3, y - 4.4, 1.8, 3, 0.5, 0, TAU);
        g.fill();
        g.fillStyle = dark(col, 0.25);
        g.beginPath();
        g.moveTo(x - 1.6, y + 12.4);
        g.lineTo(x + 1.6, y + 12.4);
        g.lineTo(x, y + 10);
        g.closePath();
        g.fill();
      }
    });
    // the keys: one goes down on each beat and springs back (the puff of paper bits is `ambient`)
    KEYS.forEach((key, k) => {
      g.save();
      g.translate(key.x, key.y - LIFT + (presses[k]?.p ?? 0) * DIP);
      cap(
        g,
        KEY_W,
        KEY_H,
        key.col ?? mix(A, "#b9a090", 0.3),
        key.letter,
        key.seed,
      );
      g.restore();
    });
    // lamplight in the doorway after sunset
    if (s.night || s.dusk) {
      g.save();
      g.globalCompositeOperation = "lighter";
      doorPath(g);
      g.fillStyle = `rgba(255,206,120,${0.14 + 0.06 * Math.sin(t * 1.3)})`;
      g.fill();
      g.restore();
    }
  },
  // the paper bits: loose in the air, never part of the tent's shape
  ambient(g, s) {
    const t = s.t;
    const presses = KEYS.map((_, k) => pressOf(k, t));
    // a puff of paper bits off each key as it goes down
    presses.forEach((k, i) => {
      const key = KEYS[i];
      if (!key || k.tau < 0 || k.tau > 1.15) return;
      const q = fixedStream(k.beat * 31 + i * 7 + 5);
      const y0 = key.y - KEY_H - 10;
      for (let j = 0; j < 9; j++) {
        const vx = (q() - 0.5) * 50;
        const vy = 36 + q() * 30;
        const col = PAPER[Math.floor(q() * PAPER.length)] ?? PAPER[0];
        const rot = q() * 6 + k.tau * (4 + q() * 6);
        g.save();
        g.globalAlpha = Math.max(0, 1 - k.tau / 1.15);
        g.translate(
          key.x + 4 + vx * k.tau,
          y0 - vy * k.tau + 52 * k.tau * k.tau,
        );
        g.rotate(rot);
        g.fillStyle = col;
        g.fillRect(-1.6, -1.1, 3.2, 2.2);
        g.strokeStyle = "rgba(48,38,28,.55)";
        g.lineWidth = 0.5;
        g.strokeRect(-1.6, -1.1, 3.2, 2.2);
        g.restore();
      }
    });
    // a little paper still drifting down round the top
    for (let i = 0; i < 9; i++) {
      const k = (t * 0.045 + i * 0.137) % 1;
      g.save();
      g.globalAlpha = 0.8 * Math.min(1, k * 6) * Math.min(1, (1 - k) * 4);
      g.translate(
        ((i * 67) % 210) - 105 + 10 * Math.sin(t * 0.7 + i * 2.1),
        -236 + k * 190,
      );
      g.rotate(t * (0.6 + (i % 3) * 0.3) + i);
      g.fillStyle = PAPER[i % PAPER.length] ?? PAPER[0];
      g.fillRect(-1.5, -1, 3, 2);
      g.restore();
    }
  },
};
