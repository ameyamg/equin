// Debug's building on Isle: the beetle station — a naturalist's field station
// built as the thing it studies: a round stone drum under a riveted copper
// dome made as a beetle's wing-cases (a standing seam down the middle, round
// glass spots), an iron cowl over the door for its head with two sprung rods
// for feelers, and six jointed iron stays for legs, braced to stone pads. It
// is the app at work: a chart recorder by the door draws its trace, calm and
// then a spike, on a paper that never stops; out in the yard a brass lens on
// a jointed arm follows a live beetle across the specimen board, showing it
// large; the trap lantern on the lens post burns from dusk and draws moths;
// the feelers stir in the wind. And it has bugs of its own: a file of ants
// runs from their hill in the grass round the paving and up the wall into a
// crack by the window, and back with crumbs; a beetle roams the paving and
// another the wall, each walking, waiting, walking on.

import {
  accent,
  castShadow,
  dark,
  doorArch,
  fittings,
  grain,
  hline,
  ink,
  ivy,
  mix,
  moss,
  oblique,
  poly,
  shrub,
  steps,
  tufts,
  wash,
  windowRect,
  bbox,
  type Box,
  type BuildingSpec,
  type Ctx2D,
  type Pt,
  type Rnd,
} from "@plugins/apps/plugins/isle/plugins/buildings/core";

const {
  TAU,
  INK,
  IRON,
  BRASS,
  BRASS_D,
  BRASS_L,
  STONE,
  disc,
  seg,
  ellShadow,
  bar,
  rivet,
  drum,
  metal,
  paving,
  gust,
  glowPane,
} = fittings;

const GRAIN_BOX: Box = [-150, -200, 190, 50];

/** The drum: its radius, how flat its round reads, the top of its wall. */
const RB = 70;
const EY = 18;
const WALL = -96;
/** The dome of the wing-cases, standing on the wall: half-width and height. */
const DOME_RX = 78;
const DOME_RY = 88;
const DOME_EY = 20;

/** The legs of one side (x mirrored for the other): hip, knee, foot — hind, middle, front. */
const LEGS: readonly (readonly [Pt, Pt, Pt])[] = [
  [
    [68, -100],
    [95, -121],
    [103, -30],
  ],
  [
    [72, -92],
    [103, -107],
    [113, -8],
  ],
  [
    [62, -80],
    [91, -91],
    [97, 10],
  ],
];

/** The glass spots of one wing-case (x mirrored for the other): x, y, radius. */
const SPOTS = [
  [30, -152, 8],
  [54, -120, 10],
  [26, -108, 8.5],
] as const;

/** The chart recorder by the door: its paper (x, y, w, h). */
const CHART = [-58, -70, 30, 22] as const;
/** The trace at paper position `u`: a calm wander, and now and then a spike. */
function trace(u: number): number {
  const c = ((u % 9.4) + 9.4) % 9.4;
  const spike =
    9 * Math.exp(-((c - 4) ** 2) * 14) - 5 * Math.exp(-((c - 4.45) ** 2) * 10);
  return 2.2 * Math.sin(u * 1.7) + 1.3 * Math.sin(u * 4.1 + 1) - spike;
}

/** The specimen board in the yard: its top (a board seen from above). */
const BOARD = oblique.topFace(92, 150, 6, 16);
/** The lens post, the height of the lantern on it. */
const POLE: Pt = [166, 24];
const POLE_TOP = -46;
/** Where the live beetle is at `t`, on the board. */
const beetleAt = (t: number): Pt => [
  125 + 19 * Math.sin(t * 0.23) + 5 * Math.sin(t * 0.71 + 1),
  -1 + 2.6 * Math.sin(t * 0.37 + 2),
];

/** A beetle seen from above at (x, y), `k` its scale, heading `d` (±1), its legs at `step`. */
function beetle(
  g: Ctx2D,
  x: number,
  y: number,
  k: number,
  d: number,
  step: number,
): void {
  g.save();
  g.translate(x, y);
  g.scale(k * d, k);
  g.strokeStyle = "#2a2622";
  g.lineWidth = 0.55;
  g.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const lx = -1.6 + i * 1.7;
    const sw = Math.sin(step + i * 2.1) * 0.9;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(lx, side * 1.2);
      g.lineTo(lx + sw * side, side * 2.9);
      g.lineTo(lx + sw * side + 0.7, side * 3.7);
      g.stroke();
    }
  }
  g.fillStyle = "#34302a";
  g.beginPath();
  g.ellipse(-0.5, 0, 3.1, 2, 0, 0, TAU);
  g.fill();
  g.fillStyle = "#1f1c19";
  g.beginPath();
  g.ellipse(2.9, 0, 1.3, 1.25, 0, 0, TAU);
  g.fill();
  g.strokeStyle = "rgba(190,176,140,.5)";
  g.lineWidth = 0.4;
  seg(g, -3.3, 0, 1.9, 0);
  g.stroke();
  g.strokeStyle = "#2a2622";
  g.lineWidth = 0.4;
  g.beginPath();
  g.moveTo(3.8, -0.5);
  g.lineTo(5.4, -1.5 + Math.sin(step * 0.7) * 0.4);
  g.moveTo(3.8, 0.5);
  g.lineTo(5.4, 1.5 - Math.sin(step * 0.7) * 0.4);
  g.stroke();
  g.restore();
}

/** The ants' road: from their hill in the grass, round the front of the paving, up the wall to a crack by the window. */
const ANT_HILL: Pt = [-66, 29];
const ANT_CRACK: Pt = [61, -31];
const ANT_ROAD: readonly Pt[] = (() => {
  const via: readonly Pt[] = [
    ANT_HILL,
    [-50, 32],
    [-34, 34],
    [-14, 32],
    [14, 27],
    [40, 22],
    [58, 13],
    [65, 0],
    [63, -12],
    [62.5, -22],
    ANT_CRACK,
  ];
  const at = (i: number): Pt => via[Math.max(0, Math.min(via.length - 1, i))]!;
  const out: Pt[] = [];
  for (let i = 0; i < via.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < 8; k++) {
      const u = k / 8;
      const c = (a: number, b: number, d: number, e: number): number =>
        0.5 *
        (2 * b +
          (d - a) * u +
          (2 * a - 5 * b + 4 * d - e) * u * u +
          (3 * b - a - 3 * d + e) * u * u * u);
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(ANT_CRACK);
  return out;
})();
/** The road's length up to each of its points. */
const ANT_AT: readonly number[] = ANT_ROAD.reduce<number[]>((acc, q, i) => {
  const o = ANT_ROAD[i - 1];
  acc.push(i && o ? acc[i - 1]! + Math.hypot(q[0] - o[0], q[1] - o[1]) : 0);
  return acc;
}, []);
const ANT_LEN = ANT_AT[ANT_AT.length - 1] ?? 0;
const ANTS = 15;

/** A fixed number in 0..1 for `n` (`animate` has no random stream): the same every frame. */
const hash = (n: number): number => {
  const v = Math.sin(n * 12.9898 + 4.1) * 43758.5453;
  return v - Math.floor(v);
};

/** The point `u` px along the ants' road, and the road's heading there. */
function roadAt(u: number): { x: number; y: number; a: number } {
  let i = 1;
  while (i < ANT_ROAD.length - 1 && (ANT_AT[i] ?? 0) < u) i++;
  const p = ANT_ROAD[i - 1]!;
  const q = ANT_ROAD[i]!;
  const l0 = ANT_AT[i - 1] ?? 0;
  const f = Math.max(0, Math.min(1, (u - l0) / ((ANT_AT[i] ?? 1) - l0 || 1)));
  return {
    x: p[0] + (q[0] - p[0]) * f,
    y: p[1] + (q[1] - p[1]) * f,
    a: Math.atan2(q[1] - p[1], q[0] - p[0]),
  };
}

/** An ant seen from above at (x, y), heading `a`, its six legs at `step` (a tripod gait); `load`: it carries a crumb. */
function ant(
  g: Ctx2D,
  x: number,
  y: number,
  a: number,
  step: number,
  load: boolean,
): void {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.scale(0.85, 0.85);
  g.strokeStyle = "#231d18";
  g.lineWidth = 0.34;
  g.lineCap = "round";
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    const lx = -0.5 + i * 0.75;
    for (const side of [-1, 1]) {
      const sw = 0.5 * Math.sin(step + (i + (side > 0 ? 1 : 0)) * Math.PI);
      g.moveTo(lx, side * 0.3);
      g.lineTo(lx + (i - 1) * 0.5 + sw * 0.5, side * 1.25);
      g.lineTo(lx + (i - 1) * 0.8 + sw, side * 1.9);
    }
  }
  g.moveTo(1.5, -0.2);
  g.lineTo(2.3, -0.8 + 0.15 * Math.sin(step * 0.6));
  g.moveTo(1.5, 0.2);
  g.lineTo(2.3, 0.8 - 0.15 * Math.sin(step * 0.6 + 1));
  g.stroke();
  g.fillStyle = "#231d18";
  g.beginPath();
  g.ellipse(-1.35, 0, 1, 0.72, 0, 0, TAU);
  g.ellipse(0, 0, 0.62, 0.42, 0, 0, TAU);
  g.ellipse(1.1, 0, 0.52, 0.48, 0, 0, TAU);
  g.fill();
  if (load) {
    g.fillStyle = "#d9cba4";
    g.beginPath();
    g.ellipse(2, 0, 0.75, 0.6, 0.4, 0, TAU);
    g.fill();
  }
  g.restore();
}

/** The beetles at large: where each roams (x, y, half-width, half-height), its size, how long one walk-and-wait lasts. */
const ROAMERS = [
  [-36, 4, 20, 5, 0.85, 7.5],
  [-40, -27, 10, 9, 0.7, 9.5],
] as const;

/** A roaming beetle at `t`: it walks to a new spot, waits there, walks on. Its place, heading, and how far its legs have stepped. */
function roamAt(
  i: number,
  t: number,
): { x: number; y: number; a: number; step: number } {
  const [cx, cy, hw, hh, , period] = ROAMERS[i]!;
  const n = Math.floor(t / period + i * 0.37);
  const tau = (t / period + i * 0.37 - n) / 0.45;
  const spot = (k: number): Pt => [
    cx + (hash(k * 7 + i * 31) * 2 - 1) * hw,
    cy + (hash(k * 13 + i * 17 + 5) * 2 - 1) * hh,
  ];
  const [p, q] = [spot(n), spot(n + 1)];
  const u = Math.max(0, Math.min(1, tau));
  const e = u * u * (3 - 2 * u);
  const dist = Math.hypot(q[0] - p[0], q[1] - p[1]);
  return {
    x: p[0] + (q[0] - p[0]) * e,
    y: p[1] + (q[1] - p[1]) * e,
    a: Math.atan2(q[1] - p[1], q[0] - p[0]),
    step: n * 3 + e * dist * 1.6,
  };
}

/** The dome's outline: the wing-cases from rim to crown, and the rim's near edge. */
function domePath(g: Ctx2D): void {
  g.beginPath();
  g.ellipse(0, WALL, DOME_RX, DOME_RY, 0, Math.PI, TAU);
  g.ellipse(0, WALL, DOME_RX, DOME_EY, 0, 0, Math.PI);
  g.closePath();
}

/** One jointed iron stay, hip to knee to foot, on its stone pad. */
function leg(g: Ctx2D, r: Rnd, d: number, pts: readonly [Pt, Pt, Pt]): void {
  const [hip, knee, foot] = pts;
  ellShadow(g, d * foot[0] + 5, foot[1] + 2, 11, 3.4, 0.3);
  const pad = () => {
    g.beginPath();
    g.ellipse(d * foot[0], foot[1], 9, 3.6, 0, 0, TAU);
  };
  wash(
    g,
    pad,
    [d * foot[0] - 9, foot[1] - 4, d * foot[0] + 9, foot[1] + 4],
    "#a39c8b",
    r,
    {
      blob: 3,
      shadeA: 0.25,
      lw: 1.1,
    },
  );
  g.beginPath();
  g.moveTo(d * hip[0], hip[1]);
  g.lineTo(d * knee[0], knee[1]);
  g.lineTo(d * foot[0], foot[1] - 1);
  bar(g, 5.4, IRON, "rgba(230,236,240,.22)");
  for (const [x, y] of [knee, hip]) {
    disc(g, d * x, y, 4.2);
    g.fillStyle = BRASS_D;
    g.fill();
    ink(g, 1);
    g.stroke();
    rivet(g, d * x - 0.6, y - 0.6, 1.3);
  }
}

/** A feeler from the cowl: a sprung iron rod with a brass ball, bent by `sway`. */
function feeler(g: Ctx2D, d: number, sway: number): void {
  const tx = d * 50 + sway * 7;
  const ty = -152 + Math.abs(sway) * 2;
  g.beginPath();
  g.moveTo(d * 12, -97);
  g.quadraticCurveTo(d * 20 + sway * 2, -134, tx, ty);
  bar(g, 2, IRON, null);
  disc(g, tx, ty, 3);
  g.fillStyle = BRASS;
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 0.9;
  g.stroke();
}

export const beetleStation: BuildingSpec = {
  door: { kind: "leaf", w: 34, h: 58, arch: true },
  footprint: {
    w: 150,
    depth: 70,
    ground: [-125, -112, 186, 40],
    upper: [-109, -187, 109, -112],
  },
  setting: ["forest", "hill", "lane"],
  signX: -128,
  lights: [
    [0, -30, 16],
    [46, -56, 13],
    [-43, -59, 12],
    [-54, -120, 11],
    [54, -120, 11],
    [-30, -152, 9],
    [30, -152, 9],
    [166, -54, 14],
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const A = accent(s.hue);
    const SHELL = mix("#a05a42", A, 0.14);
    castShadow(
      g,
      [
        [-50, 8],
        [70, 8],
        [112, 14],
        [118, -12],
        [80, -30],
      ],
      0.28,
    );
    paving(g, r, 2, -6, 96, 24);
    // the hind and middle legs, behind the drum
    for (const d of [-1, 1]) {
      leg(g, r, d, LEGS[0]!);
      leg(g, r, d, LEGS[1]!);
    }
    // the drum
    drum(g, r, {
      rb: RB,
      rt: RB - 2,
      yb: -EY,
      yt: WALL,
      ey: EY,
      row: 9,
      joint: 0.24,
      top: null,
      tone: STONE,
    });
    // the wing-cases: riveted copper under old red lead, a standing seam down the middle
    metal(
      g,
      r,
      () => domePath(g),
      [-DOME_RX, WALL - DOME_RY, DOME_RX, WALL + DOME_EY],
      SHELL,
      {
        verd: 0.1,
        bare: 0.1,
        shade: 0.46,
        lw: 1.6,
        inside: () => {
          for (const h of [20, 42, 62, 78]) {
            const k = Math.sqrt(1 - (h / DOME_RY) ** 2);
            g.beginPath();
            g.ellipse(0, WALL - h, DOME_RX * k, DOME_EY * k, 0, 0, Math.PI);
            g.strokeStyle = "rgba(36,26,18,.5)";
            g.lineWidth = 1.1;
            g.stroke();
            g.beginPath();
            g.ellipse(0, WALL - h - 1.2, DOME_RX * k, DOME_EY * k, 0, 0.3, 1.5);
            g.strokeStyle = "rgba(255,236,200,.22)";
            g.stroke();
            for (let a = 0.16; a < Math.PI; a += 0.2)
              rivet(
                g,
                -Math.cos(a) * DOME_RX * k,
                WALL - h + Math.sin(a) * DOME_EY * k + 2.6,
                1,
              );
          }
          const hi = g.createRadialGradient(-30, -156, 2, -30, -156, 54);
          hi.addColorStop(0, "rgba(255,240,210,.26)");
          hi.addColorStop(1, "rgba(255,240,210,0)");
          g.fillStyle = hi;
          g.fillRect(-DOME_RX, WALL - DOME_RY, 2 * DOME_RX, DOME_RY + DOME_EY);
          seg(g, 0, WALL - DOME_RY, 0, WALL + DOME_EY);
          bar(g, 3.4, dark(SHELL, 0.5), "rgba(255,236,200,.3)");
          for (let y = WALL - DOME_RY + 8; y < WALL + DOME_EY; y += 9) {
            rivet(g, -5, y, 1);
            rivet(g, 4, y, 1);
          }
        },
      },
    );
    // the spots: round glass in iron rings
    for (const d of [-1, 1])
      for (const [x, y, rad] of SPOTS) {
        g.beginPath();
        g.ellipse(d * x, y, rad + 2.4, (rad + 2.4) * 0.9, 0, 0, TAU);
        g.fillStyle = "#2b2824";
        g.fill();
        ink(g, 1);
        g.stroke();
        const gl = g.createLinearGradient(
          d * x - rad,
          y - rad,
          d * x + rad,
          y + rad,
        );
        if (lit) {
          gl.addColorStop(0, "#ffe2a0");
          gl.addColorStop(1, "#e2a04e");
        } else {
          gl.addColorStop(0, "#5c676a");
          gl.addColorStop(1, "#22282b");
        }
        g.beginPath();
        g.ellipse(d * x, y, rad, rad * 0.9, 0, 0, TAU);
        g.fillStyle = gl;
        g.fill();
        if (!lit) {
          g.strokeStyle = "rgba(220,230,230,.3)";
          g.lineWidth = 1.2;
          g.beginPath();
          g.ellipse(d * x, y, rad * 0.62, rad * 0.56, 0, 3.5, 4.6);
          g.stroke();
        }
      }
    // the gutter round the rim
    g.beginPath();
    g.ellipse(0, WALL, DOME_RX, DOME_EY, 0, 0.04, Math.PI - 0.04);
    bar(g, 3.6, BRASS_D, "rgba(255,240,200,.25)");
    // the front legs
    for (const d of [-1, 1]) leg(g, r, d, LEGS[2]!);
    // the door, a window, the recorder's case
    doorArch(g, 0, 0, 34, 58, r, { col: mix(A, "#5e4a36", 0.4) });
    ink(g, 0.9, 0.7);
    hline(g, 0, -56, 0, 0, r, 0.2);
    steps(g, 0, 2, 40, 2, r);
    windowRect(g, 35, -40, 22, 32, r, {
      arch: true,
      lit,
      frame: "#4a3a2c",
      sill: "#b3ab98",
    });
    const [cx, cy, cw, ch] = CHART;
    g.fillStyle = "rgba(24,20,14,.3)";
    g.fillRect(cx - 2, cy - 1, cw + 9, ch + 7);
    g.fillStyle = BRASS;
    g.fillRect(cx - 4, cy - 4, cw + 9, ch + 8);
    ink(g, 1.2);
    g.strokeRect(cx - 4, cy - 4, cw + 9, ch + 8);
    g.fillStyle = "rgba(255,240,200,.3)";
    g.fillRect(cx - 3, cy - 3, cw + 7, 1.4);
    g.fillStyle = "#3b352c";
    g.fillRect(cx, cy, cw, ch);
    for (const [x, y] of [
      [cx - 3, cy - 3],
      [cx + cw + 3, cy - 3],
      [cx - 3, cy + ch + 2],
      [cx + cw + 3, cy + ch + 2],
    ] as const)
      rivet(g, x, y, 1);
    // the head: an iron cowl over the door, two round eyes
    const cowl = () => {
      g.beginPath();
      g.ellipse(0, -66, 33, 34, 0, Math.PI, TAU);
      g.ellipse(0, -66, 33, 7, 0, 0, Math.PI);
      g.closePath();
    };
    metal(g, r, cowl, [-33, -100, 33, -59], "#4a4741", {
      verd: 0.08,
      bare: 0.2,
      bareCol: "110,74,50",
      shade: 0.4,
      streaks: 4,
      lw: 1.5,
      inside: () => {
        g.strokeStyle = "rgba(20,16,12,.5)";
        g.lineWidth = 1;
        seg(g, 0, -100, 0, -59);
        g.stroke();
        for (let a = 0.3; a < Math.PI; a += 0.32)
          rivet(g, -Math.cos(a) * 30, -66 - Math.sin(a) * 30, 1);
      },
    });
    for (const d of [-1, 1]) {
      disc(g, d * 17, -78, 6.4);
      g.fillStyle = BRASS_D;
      g.fill();
      ink(g, 1);
      g.stroke();
      disc(g, d * 17, -78, 4.4);
      g.fillStyle = lit ? "#ffd98a" : "#2c3336";
      g.fill();
      ink(g, 0.8);
      g.stroke();
    }
    // the specimen board on its trestle: cork, a row of pinned beetles, a label under each
    ellShadow(g, 132, 26, 36, 5, 0.3);
    for (const [x, y] of [
      [95, 6],
      [148, 6],
      [163, -5],
    ] as const) {
      g.fillStyle = "#6a543c";
      g.fillRect(x - 1.6, y, 3.2, 19);
      ink(g, 0.9);
      g.strokeRect(x - 1.6, y, 3.2, 19);
    }
    oblique.fill(g, BOARD, (pts) =>
      wash(g, () => poly(g, pts), bbox(pts), "#b79e72", r, {
        blob: 4,
        var: 18,
        shadeA: 0.2,
        lw: 1.3,
      }),
    );
    g.fillStyle = "#7d6648";
    g.fillRect(92, 6, 58, 3.4);
    ink(g, 1);
    g.strokeRect(92, 6, 58, 3.4);
    for (let i = 0; i < 6; i++) {
      const x = 114 + i * 8.4;
      g.fillStyle = i % 2 ? "#3a3129" : "#4b3a2a";
      g.beginPath();
      g.ellipse(x, -3.2, 2.3, 1.5, 0, 0, TAU);
      g.fill();
      g.fillStyle = BRASS_L;
      g.fillRect(x - 0.4, -3.6, 0.9, 0.9);
    }
    // the lens post, and the trap lantern's cage on top of it (its light is drawn live)
    ellShadow(g, POLE[0] + 6, POLE[1] + 1, 10, 3, 0.3);
    seg(g, POLE[0], POLE[1], POLE[0], POLE_TOP);
    bar(g, 3.4, BRASS_D, "rgba(255,240,200,.3)");
    g.fillStyle = IRON;
    g.fillRect(POLE[0] - 5, POLE[1] - 2, 10, 3);
    g.fillRect(POLE[0] - 6, POLE_TOP - 2, 12, 2.4);
    g.beginPath();
    g.moveTo(POLE[0] - 7, POLE_TOP - 18);
    g.lineTo(POLE[0], POLE_TOP - 24);
    g.lineTo(POLE[0] + 7, POLE_TOP - 18);
    g.closePath();
    g.fill();
    ink(g, 1);
    g.stroke();
    // the ants' hill in the grass, and the crack in the wall their road ends at
    {
      const [hx, hy] = ANT_HILL;
      ellShadow(g, hx + 1.5, hy + 1, 7, 2.2, 0.22);
      wash(
        g,
        () => {
          g.beginPath();
          g.moveTo(hx - 6.5, hy + 1.2);
          g.quadraticCurveTo(hx - 3, hy - 4.6, hx, hy - 4.4);
          g.quadraticCurveTo(hx + 3.4, hy - 4.4, hx + 6.5, hy + 1.2);
          g.quadraticCurveTo(hx, hy + 3, hx - 6.5, hy + 1.2);
          g.closePath();
        },
        [hx - 7, hy - 5, hx + 7, hy + 3],
        "#a08a64",
        r,
        { blob: 2, var: 12, stipple: 10, shadeA: 0.22, lw: 0.9 },
      );
      g.fillStyle = "#2a231b";
      g.beginPath();
      g.ellipse(hx + 0.4, hy - 2.2, 1.7, 1, 0, 0, TAU);
      g.fill();
      const [kx, ky] = ANT_CRACK;
      g.strokeStyle = "rgba(30,24,18,.8)";
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(kx + 1.2, ky + 9);
      g.lineTo(kx - 0.6, ky + 4);
      g.lineTo(kx + 0.8, ky);
      g.lineTo(kx - 1, ky - 5);
      g.lineTo(kx + 0.4, ky - 9);
      g.stroke();
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(kx - 0.6, ky + 4);
      g.lineTo(kx - 3.4, ky + 5.4);
      g.moveTo(kx - 1, ky - 5);
      g.lineTo(kx + 2.2, ky - 7);
      g.stroke();
      g.fillStyle = "#1f1a15";
      g.beginPath();
      g.ellipse(kx + 0.3, ky, 1.5, 2.2, 0, 0, TAU);
      g.fill();
    }
    // what grows about
    ivy(g, -62, -4, -70, r, 16);
    moss(g, -70, 70, 0, r, 14);
    tufts(g, -96, 100, 6, r, 22);
    tufts(g, 150, 176, 24, r, 5);
    for (const [x, y, z, k] of [
      [-88, 10, 10, 0],
      [80, -34, 9, 1],
      [-34, 26, 6, 2],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    const dim = s.night || s.dusk;
    // the feelers stir
    feeler(g, -1, 0.5 * (gust(t, 0.4) - 0.5) + 0.12 * Math.sin(t * 1.9));
    feeler(g, 1, 0.5 * (gust(t, 2.1) - 0.5) + 0.12 * Math.sin(t * 1.6 + 1));
    // the chart recorder: the paper runs on to the left, the pen draws what it feels
    {
      const [x, y, w, h] = CHART;
      const mid = y + h / 2 + 2;
      const run = t * 1.5;
      g.save();
      g.beginPath();
      g.rect(x, y, w, h);
      g.clip();
      g.fillStyle = dim ? "#d9cba4" : "#e2d9c0";
      g.fillRect(x, y, w, h);
      g.strokeStyle = "rgba(96,120,110,.34)";
      g.lineWidth = 0.6;
      for (let gy = y + 3.5; gy < y + h; gy += 5) {
        seg(g, x, gy, x + w, gy);
        g.stroke();
      }
      const off = (run * 5) % 6;
      for (let gx = x + w - off; gx > x; gx -= 6) {
        seg(g, gx, y, gx, y + h);
        g.stroke();
      }
      g.strokeStyle = "#7c3a2c";
      g.lineWidth = 1.1;
      g.lineJoin = "round";
      g.beginPath();
      for (let px = 0; px <= w - 3; px += 0.75) {
        const py = mid + trace(run - (w - 3 - px) / 5);
        if (px === 0) g.moveTo(x + px, py);
        else g.lineTo(x + px, py);
      }
      g.stroke();
      g.restore();
      const py = mid + trace(run);
      g.strokeStyle = INK;
      g.lineWidth = 1;
      seg(g, x + w + 3, y - 2, x + w - 3, py);
      g.stroke();
      disc(g, x + w - 3, py, 1.3);
      g.fillStyle = "#7c3a2c";
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 0.9;
      g.strokeRect(x, y, w, h);
    }
    // the beetle crossing the board, and the lens that follows it a moment behind
    {
      const [bx, by] = beetleAt(t);
      const ahead = beetleAt(t + 0.3)[0] - bx;
      const d = ahead >= 0 ? 1 : -1;
      const step = t * 9 * Math.min(1, Math.abs(ahead) * 3);
      beetle(g, bx, by, 1, d, step);
      const [lx, ly0] = beetleAt(t - 0.7);
      const ly = ly0 - 5;
      const RAD = 13;
      // the arm: from the post, an elbow, down to the rim
      g.beginPath();
      g.moveTo(POLE[0], POLE_TOP + 14);
      g.lineTo((POLE[0] + lx) / 2 + 8, POLE_TOP - 2);
      g.lineTo(lx + 4, ly - RAD + 1);
      bar(g, 2.2, BRASS, "rgba(255,244,214,.35)");
      disc(g, (POLE[0] + lx) / 2 + 8, POLE_TOP - 2, 2.6);
      g.fillStyle = BRASS_D;
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 0.9;
      g.stroke();
      // what the glass shows: the board, and the beetle, large
      g.save();
      disc(g, lx, ly, RAD);
      g.clip();
      g.fillStyle = "#c6b086";
      g.fillRect(lx - RAD, ly - RAD, 2 * RAD, 2 * RAD);
      g.fillStyle = "rgba(120,96,60,.3)";
      for (let i = 0; i < 6; i++)
        g.fillRect(
          lx - RAD + ((i * 37 + Math.floor(lx * 2.6) * 3) % 26),
          ly - RAD + ((i * 53) % 26),
          1.6,
          1.6,
        );
      beetle(g, lx + (bx - lx) * 2.6, ly + (by - ly0) * 2.6 + 1, 2.6, d, step);
      g.fillStyle = "rgba(226,238,238,.16)";
      g.fillRect(lx - RAD, ly - RAD, 2 * RAD, 2 * RAD);
      g.restore();
      disc(g, lx, ly, RAD);
      bar(g, 2.6, BRASS, "rgba(255,244,214,.4)");
      g.strokeStyle = "rgba(240,246,246,.5)";
      g.lineWidth = 1.3;
      g.beginPath();
      g.arc(lx, ly, RAD - 3.5, 3.5, 4.5);
      g.stroke();
    }
    // the trap lantern: it burns from dusk, and the moths come to it
    {
      const lx = POLE[0];
      const ly = POLE_TOP - 10;
      const f = 0.75 + 0.15 * Math.sin(t * 6.1) + 0.1 * Math.sin(t * 10.7 + 2);
      g.fillStyle = dim ? "#ffd98a" : "#c4c0aa";
      g.fillRect(lx - 5, ly - 8, 10, 16);
      g.strokeStyle = INK;
      g.lineWidth = 0.9;
      g.strokeRect(lx - 5, ly - 8, 10, 16);
      seg(g, lx - 1.7, ly - 8, lx - 1.7, ly + 8);
      g.stroke();
      seg(g, lx + 1.7, ly - 8, lx + 1.7, ly + 8);
      g.stroke();
      if (dim) {
        g.save();
        g.globalCompositeOperation = "lighter";
        const gl = g.createRadialGradient(lx, ly, 1, lx, ly, 30);
        gl.addColorStop(0, `rgba(255,214,140,${0.42 * f})`);
        gl.addColorStop(1, "rgba(255,214,140,0)");
        g.fillStyle = gl;
        g.fillRect(lx - 30, ly - 30, 60, 60);
        g.restore();
      }
    }
    // the lamps behind the glass
    glowPane(g, s, 37, -70, 18, 28, 1.2);
    for (const [i, d] of [-1, 1].entries())
      for (const [k, [x, y, rad]] of SPOTS.entries())
        glowPane(g, s, d * x, y, rad * 0.9, null, i * 2.3 + k * 1.1);
  },
  // what crawls and flutters about it: never part of its shape
  ambient(g, s) {
    const t = s.t;
    // the ants: out along their road in file to the crack in the wall, and back with a crumb
    for (let i = 0; i < ANTS; i++) {
      const back = i % 3 === 2;
      const u0 =
        (t * (6.5 + 1.2 * hash(i + 40)) +
          ((i + 0.7 * hash(i)) / ANTS) * ANT_LEN) %
        ANT_LEN;
      const u = back ? ANT_LEN - u0 : u0;
      const p = roadAt(u);
      // each keeps its own side of the road, and wavers
      const off =
        (back ? -1.3 : 0.9) * (0.5 + hash(i + 9)) +
        0.4 * Math.sin(t * 2.3 + i * 1.9);
      ant(
        g,
        p.x - Math.sin(p.a) * off,
        p.y + Math.cos(p.a) * off,
        p.a + (back ? Math.PI : 0) + 0.18 * Math.sin(t * 3.1 + i * 2.7),
        u0 * 2.6,
        back && i % 2 === 0,
      );
    }
    // the beetles at large: one on the paving, one on the wall under the recorder; each walks, waits, walks on
    for (let i = 0; i < ROAMERS.length; i++) {
      const b = roamAt(i, t);
      g.save();
      g.translate(b.x, b.y);
      g.rotate(b.a);
      beetle(g, 0, 0, ROAMERS[i]![4], 1, b.step);
      g.restore();
    }
    // the moths the trap lantern draws, from dusk
    if (s.night || s.dusk) {
      const lx = POLE[0];
      const ly = POLE_TOP - 10;
      for (const ph of [0, 2.1, 4.4]) {
        const q = t * (1.5 + ph * 0.1) + ph;
        const rad = 8 + 5 * Math.sin(q * 0.53 + ph);
        const mx = lx + Math.cos(q) * rad;
        const my = ly + Math.sin(q * 1.3 + ph) * 9;
        const flap = 2.4 * Math.abs(Math.sin(t * 16 + ph));
        g.strokeStyle = "rgba(238,230,208,.92)";
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(mx - 2.6, my - flap);
        g.lineTo(mx, my);
        g.lineTo(mx + 2.6, my - flap);
        g.stroke();
      }
    }
  },
};
