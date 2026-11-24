// Events' building on Isle: the calendar tower — a tall slim tower that is a
// wall calendar and a clock in one: a stone foot, a jettied oak storey a great
// pad of calendar leaves hangs on, a brass-rimmed clock above it, a belfry
// under a slate cap and a signal mast — every tier's right face receding
// along one vector. It is the app at work: the clock shows
// the real time, the day's leaf (the days gone crossed out, today ringed)
// lifts in the wind, tears off and flutters down to the heap at the foot, a
// signal ball is run up the mast for each thing that happened — the timeline —
// and the bell tolls now and then, and on the hour.

import {
  accent,
  bbox,
  castShadow,
  dark,
  doorArch,
  fittings,
  grain,
  ink,
  ivy,
  jit,
  lantern,
  mix,
  moss,
  oblique,
  planks,
  poly,
  shingles,
  shrub,
  steps,
  stones,
  tufts,
  wash,
  windowRect,
  type Box,
  type BuildingSpec,
  type Ctx2D,
  type PaintState,
  type Pt,
  type Rnd,
} from "@plugins/apps/plugins/isle/plugins/buildings/core";

const {
  TAU,
  INK,
  BRASS,
  BRASS_D,
  IRON,
  clamp01,
  ease,
  disc,
  seg,
  bar,
  rivet,
  streaks,
  gust,
  glowPane,
} = fittings;

const GRAIN_BOX: Box = [-150, -440, 245, 62];
const PAPER = "#e4dbc2";
/** The stone tiers' half-width, the jettied storey's, and how deep every tier's right face is. */
const HW = 50;
const JW = 54;
const D = 18;
/** The top of the stone foot, of the calendar storey, of the clock storey and of the belfry; the roof's base and apex, the mast's top. */
const Y1 = -96;
const Y2 = -196;
const Y3 = -266;
const Y4 = -310;
const RB = Y4 + 3;
const ROOF = oblique.hipRoof({
  x0: -HW - 7,
  x1: HW + 7,
  y: RB,
  d: D,
  rise: 47,
});
const APEX: Pt = ROOF.apex;
const MTOP = -410;
const CLOCK = { x: 0, y: -231, r: 28 } as const;
/** A calendar leaf's size, the y of the pad's top edge, where torn leaves land, and how long a day lasts (seconds). */
const LW = 72;
const LH = 76;
const PADY = -176;
const HEAP: Pt = [98, 12];
const PERIOD = 24;

/** 0 → 1 between `a` and `b`, eased. */
const ss = (a: number, b: number, x: number): number =>
  ease(clamp01((x - a) / (b - a)));

/** A stone tier's right face, from `yb` up to `yt`: receding, and in shade. */
function stoneSide(g: Ctx2D, r: Rnd, yb: number, yt: number): void {
  oblique.onSide(g, HW, () => {
    stones(g, 0, yt, D, yb, r, { rowH: 9, blockW: 12 });
    g.fillStyle = "rgba(30,26,20,.42)";
    g.fillRect(0, yt, D, yb - yt);
  });
}

/** A band (a string course, a beam) `h` tall, its top at `y`, round the front (half-width `hw`) and the right face. */
function band(
  g: Ctx2D,
  r: Rnd,
  hw: number,
  y: number,
  h: number,
  col: string,
): void {
  oblique.fill(g, oblique.sideFace(hw, y + h, y, D), (side) =>
    wash(g, () => poly(g, side), bbox(side), dark(col, 0.32), r, {
      blob: 2,
      var: 10,
      stipple: 6,
      lw: 1,
    }),
  );
  wash(
    g,
    () => {
      g.beginPath();
      g.rect(-hw, y, 2 * hw, h);
    },
    [-hw, y, hw, y + h],
    col,
    r,
    { blob: 3, var: 12, stipple: 20, shadeA: 0.12, lw: 1 },
  );
}

/** The colour of the `i`-th signal ball. */
const ballCol = (s: PaintState, i: number): string =>
  i % 3 === 0
    ? mix(accent(s.hue), "#6f7f78", 0.2)
    : i % 3 === 1
      ? "#7a4a3c"
      : BRASS;

/**
 * One leaf of the calendar, its top edge centred on (0, 0): a painted header, a
 * month of ruled days, the days gone crossed out and today ringed; `curl`
 * lifts its lower right corner.
 */
function calLeaf(g: Ctx2D, s: PaintState, day: number, curl: number): void {
  const path = () => {
    g.beginPath();
    g.moveTo(-LW / 2, 0);
    g.lineTo(LW / 2, 0);
    g.lineTo(LW / 2, LH * 0.5);
    g.quadraticCurveTo(
      LW / 2,
      LH - curl * 10,
      LW / 2 - curl * 10,
      LH - curl * 21,
    );
    g.lineTo(-LW / 2, LH - curl * 4);
    g.closePath();
  };
  g.save();
  path();
  g.fillStyle = s.night ? "#d9cfae" : PAPER;
  g.fill();
  g.clip();
  g.fillStyle = accent(s.hue);
  g.fillRect(-LW / 2, 0, LW, 11);
  const gx = -LW / 2 + 4.5;
  const gy = 15;
  const cw = 9;
  const ch = 11.4;
  const today = ((day % 35) + 35) % 35;
  g.strokeStyle = "rgba(70,56,36,.5)";
  g.lineWidth = 0.6;
  g.beginPath();
  for (let i = 0; i <= 7; i++) {
    g.moveTo(gx + i * cw, gy);
    g.lineTo(gx + i * cw, gy + 5 * ch);
  }
  for (let j = 0; j <= 5; j++) {
    g.moveTo(gx, gy + j * ch);
    g.lineTo(gx + 7 * cw, gy + j * ch);
  }
  g.stroke();
  g.strokeStyle = "rgba(60,46,30,.8)";
  g.lineWidth = 1;
  g.beginPath();
  for (let k = 0; k < today; k++) {
    const x = gx + (k % 7) * cw;
    const y = gy + Math.floor(k / 7) * ch;
    g.moveTo(x + 2, y + 2.6);
    g.lineTo(x + cw - 2, y + ch - 2.6);
  }
  g.stroke();
  g.strokeStyle = "#96463a";
  g.lineWidth = 1.5;
  g.beginPath();
  g.ellipse(
    gx + (today % 7) * cw + cw / 2,
    gy + Math.floor(today / 7) * ch + ch / 2,
    4.6,
    5.2,
    0,
    0,
    TAU,
  );
  g.stroke();
  g.fillStyle = `rgba(60,44,20,${0.22 * curl})`;
  g.fillRect(0, LH * 0.5, LW / 2, LH * 0.5);
  g.restore();
  path();
  g.strokeStyle = INK;
  g.lineWidth = 1;
  g.lineJoin = "round";
  g.stroke();
}

export const calendarTower: BuildingSpec = {
  door: { kind: "leaf", w: 34, h: 60, head: 17 },
  footprint: {
    w: 108,
    depth: 60,
    ground: [-140, -112, 240, 50],
    upper: [-60, -416, 80, -112],
  },
  setting: ["square"],
  signX: -115,
  lights: [
    [0, -32, 20],
    [0, -231, 34],
    [0, -78, 11],
    [0, -138, 28],
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const A = accent(s.hue);
    castShadow(
      g,
      [
        [-40, 3],
        [56, 3],
        [192, 32],
        [228, 12],
        [70, -13],
      ],
      0.27,
    );
    // the stone foot
    stoneSide(g, r, 0, Y1);
    stones(g, -HW, Y1, HW, 0, r, { rowH: 9, blockW: 17 });
    for (let y = 0, k = 0; y > Y1 + 8; y -= 14, k++)
      for (const [qx, qw] of [
        [-HW, k % 2 ? 13 : 9],
        [HW - (k % 2 ? 9 : 13), k % 2 ? 9 : 13],
      ] as const) {
        g.fillStyle = jit("#cbc4b2", r, 12);
        g.fillRect(qx, y - 13, qw, 12);
        ink(g, 0.8, 0.5);
        g.strokeRect(qx, y - 13, qw, 12);
      }
    windowRect(g, -8, -69, 16, 20, r, { arch: true, lit, sill: "#a49d8c" });
    doorArch(g, 0, 0, 34, 60, r, { col: A });
    steps(g, 0, 2, 38, 2, r);
    lantern(g, -31, -54, lit);
    lantern(g, 31, -54, lit);
    // the calendar storey: a jettied oak box the pad hangs on, its boarded side receding like the stone above and below
    oblique.onSide(g, JW, () => {
      planks(g, 0, Y2, D, Y1, r, { base: "#75603f", pw: 6 });
      g.fillStyle = "rgba(24,18,10,.45)";
      g.fillRect(0, Y2, D, Y1 - Y2);
    });
    planks(g, -JW, Y2, JW, Y1, r, { base: "#75603f", pw: 8 });
    g.save();
    g.beginPath();
    g.rect(-JW, Y2, 2 * JW, Y1 - Y2);
    g.clip();
    streaks(g, r, [-JW, Y2, JW, Y1], 10, "36,28,18", 0.16, 60);
    g.restore();
    for (const x of [-JW + 3, JW - 3]) {
      seg(g, x, Y1 - 4, x, Y2 + 4);
      bar(g, 4, "#5a4632", "rgba(255,240,210,.2)");
    }
    band(g, r, JW + 2, Y1 - 3, 7, "#5a4632");
    for (const x of [-36, -12, 12, 36]) {
      g.fillStyle = "#463626";
      g.fillRect(x - 3, Y1 + 4, 6, 6);
      ink(g, 0.8, 0.7);
      g.strokeRect(x - 3, Y1 + 4, 6, 6);
    }
    // the pad: a block of leaves under a brass binding, hung from two iron rings (the top leaf is animated)
    g.fillStyle = "rgba(24,18,10,.35)";
    g.fillRect(-LW / 2 + 5, PADY + 3, LW + 2, LH + 6);
    for (let k = 5; k >= 1; k--) {
      g.fillStyle = k % 2 ? "#cfc5aa" : "#b9ad8e";
      g.fillRect(-LW / 2 + k * 0.8, PADY, LW, LH + k * 1.1);
      ink(g, 0.5, 0.5);
      g.strokeRect(-LW / 2 + k * 0.8, PADY, LW, LH + k * 1.1);
    }
    g.fillStyle = PAPER;
    g.fillRect(-LW / 2, PADY, LW, LH);
    g.fillStyle = A;
    g.fillRect(-LW / 2, PADY, LW, 11);
    ink(g, 0.9);
    g.strokeRect(-LW / 2, PADY, LW, LH);
    g.fillStyle = BRASS;
    g.fillRect(-LW / 2 - 3, PADY - 9, LW + 8, 10);
    ink(g, 1.1);
    g.strokeRect(-LW / 2 - 3, PADY - 9, LW + 8, 10);
    g.fillStyle = "rgba(255,244,214,.3)";
    g.fillRect(-LW / 2 - 2, PADY - 8, LW + 6, 2);
    for (let x = -LW / 2 + 2; x < LW / 2 + 4; x += 9)
      rivet(g, x, PADY - 4, 0.9);
    for (const x of [-20, 20]) {
      g.strokeStyle = IRON;
      g.lineWidth = 2.2;
      g.beginPath();
      g.arc(x, PADY - 11, 4.5, 0, TAU);
      g.stroke();
      disc(g, x, PADY - 15.5, 1.8);
      g.fillStyle = IRON;
      g.fill();
    }
    // the clock storey (the hands are animated: they show the real time)
    stoneSide(g, r, Y2, Y3);
    stones(g, -HW, Y3, HW, Y2, r, { rowH: 9, blockW: 16 });
    band(g, r, JW + 2, Y2 - 3, 6, "#c3bba7");
    // the clock's case stands proud of the wall: its drum seen going back to the stonework, in shade
    {
      const [kx, ky] = oblique.back([CLOCK.x, CLOCK.y], 6);
      g.save();
      g.lineCap = "round";
      seg(g, CLOCK.x, CLOCK.y, kx, ky);
      g.strokeStyle = INK;
      g.lineWidth = 2 * (CLOCK.r + 6.25) + 1.2;
      g.stroke();
      g.strokeStyle = BRASS_D;
      g.lineWidth = 2 * (CLOCK.r + 6.25) - 1.2;
      g.stroke();
      g.restore();
    }
    disc(g, CLOCK.x, CLOCK.y, CLOCK.r + 4);
    bar(g, 4.5, BRASS, "rgba(226,204,150,.5)");
    wash(
      g,
      () => disc(g, CLOCK.x, CLOCK.y, CLOCK.r),
      [
        CLOCK.x - CLOCK.r,
        CLOCK.y - CLOCK.r,
        CLOCK.x + CLOCK.r,
        CLOCK.y + CLOCK.r,
      ],
      lit ? "#f3dea0" : "#e6dcc0",
      r,
      { blob: 5, var: 14, shadeA: 0.14, lw: 1.2 },
    );
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      const l = k % 3 ? 4 : 7;
      g.strokeStyle = "#3a2e22";
      g.lineWidth = k % 3 ? 1.1 : 2.2;
      seg(
        g,
        CLOCK.x + Math.cos(a) * (CLOCK.r - 2.5),
        CLOCK.y + Math.sin(a) * (CLOCK.r - 2.5),
        CLOCK.x + Math.cos(a) * (CLOCK.r - 2.5 - l),
        CLOCK.y + Math.sin(a) * (CLOCK.r - 2.5 - l),
      );
      g.stroke();
    }
    // the belfry and its slate cap, the signal mast
    stoneSide(g, r, Y3, Y4);
    stones(g, -HW, Y4, HW, Y3, r, { rowH: 9, blockW: 14 });
    g.beginPath();
    g.moveTo(-17, Y3 - 4);
    g.lineTo(-17, Y3 - 22);
    g.arc(0, Y3 - 22, 17, Math.PI, 0);
    g.lineTo(17, Y3 - 4);
    g.closePath();
    g.fillStyle = "#1e1a16";
    g.fill();
    ink(g, 1.1);
    g.stroke();
    band(g, r, HW + 3, Y3 - 3, 6, "#c3bba7");
    oblique.fill(g, ROOF.side, (pts) => {
      g.fillStyle = "#4b4f55";
      poly(g, pts);
      g.fill();
      ink(g, 1.2);
      g.stroke();
    });
    oblique.fill(g, ROOF.front, (pts) =>
      shingles(g, pts, r, { base: "#6c6f73", rowH: 6.5, w: 9 }),
    );
    seg(g, APEX[0], APEX[1] + 2, APEX[0], MTOP);
    bar(g, 2, IRON, null);
    disc(g, APEX[0], MTOP - 2, 3);
    g.fillStyle = BRASS;
    g.fill();
    ink(g, 0.9);
    g.stroke();
    // a sundial in the yard, the heap the torn leaves land on
    g.save();
    g.translate(146, 36);
    castShadow(
      g,
      [
        [-9, 0],
        [10, 0],
        [26, 7],
        [6, 7],
      ],
      0.28,
    );
    stones(g, -6, -27, 6, 0, r, { rowH: 6, blockW: 8, base: "#a59d8b" });
    g.beginPath();
    g.ellipse(0, -28, 14, 5, 0, 0, TAU);
    g.fillStyle = "#b9b2a0";
    g.fill();
    ink(g, 1);
    g.stroke();
    poly(g, [
      [-6, -28],
      [6, -28],
      [6, -41],
    ]);
    g.fillStyle = BRASS;
    g.fill();
    ink(g, 0.9);
    g.stroke();
    g.restore();
    for (let k = 0; k < 7; k++) {
      g.save();
      g.translate(HEAP[0] + (r() - 0.5) * 28, HEAP[1] + (r() - 0.5) * 9);
      g.rotate((r() - 0.5) * 1.4);
      g.fillStyle = jit(PAPER, r, 12);
      g.fillRect(-9, -4, 18, 9);
      ink(g, 0.7, 0.7);
      g.strokeRect(-9, -4, 18, 9);
      g.fillStyle = A;
      g.fillRect(-9, -4, 18, 2.2);
      g.restore();
    }
    ivy(g, -HW + 4, -2, -90, r, 16);
    moss(g, -HW - 2, HW + 2, 1, r, 12);
    tufts(g, -66, 76, 3, r, 20);
    for (const [x, y, z, k] of [
      [-124, 8, 12, 0],
      [-54, 38, 8, 2],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    // the hands show the real time
    const d = new Date();
    const hr = (d.getHours() % 12) + d.getMinutes() / 60;
    const mn = d.getMinutes() + d.getSeconds() / 60;
    for (const [f, len, w] of [
      [hr / 12, 16, 3.2],
      [mn / 60, 23, 2],
    ] as const) {
      seg(
        g,
        CLOCK.x - Math.sin(f * TAU) * 4,
        CLOCK.y + Math.cos(f * TAU) * 4,
        CLOCK.x + Math.sin(f * TAU) * len,
        CLOCK.y - Math.cos(f * TAU) * len,
      );
      g.strokeStyle = "#2a221a";
      g.lineCap = "round";
      g.lineWidth = w;
      g.stroke();
    }
    disc(g, CLOCK.x, CLOCK.y, 2.6);
    g.fillStyle = BRASS_D;
    g.fill();
    glowPane(g, s, CLOCK.x, CLOCK.y, CLOCK.r, null, 0.8);
    // the bell tolls now and then, and on the hour
    const tc = t % 37;
    const onHour = d.getMinutes() === 0 && d.getSeconds() < 14;
    const amp = onHour ? 0.34 : tc < 10 ? 0.34 * Math.exp(-tc * 0.32) : 0;
    const ba = Math.sin(t * 4.1) * amp + Math.sin(t * 1.3) * 0.025;
    g.save();
    g.translate(0, Y3 - 37);
    g.rotate(ba);
    g.fillStyle = IRON;
    g.fillRect(-1.2, 0, 2.4, 6);
    const bg = g.createLinearGradient(-13, 0, 13, 0);
    bg.addColorStop(0, "#8a6a32");
    bg.addColorStop(0.35, "#c79a4a");
    bg.addColorStop(1, "#5e4620");
    g.fillStyle = bg;
    g.beginPath();
    g.moveTo(-6, 6);
    g.quadraticCurveTo(-7.5, 19, -13, 25);
    g.lineTo(13, 25);
    g.quadraticCurveTo(7.5, 19, 6, 6);
    g.closePath();
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1;
    g.lineJoin = "round";
    g.stroke();
    g.rotate(-ba * 1.8);
    disc(g, 0, 26, 2.4);
    g.fillStyle = IRON;
    g.fill();
    g.restore();
    // the day's leaf: its corner lifts in the wind, peels, and now and then it tears off and flutters down to the heap
    const day = Math.floor(t / PERIOD);
    const c = t - day * PERIOD;
    const peel = ss(PERIOD - 3.5, PERIOD, c);
    const curl = Math.max(
      peel,
      0.05 + 0.3 * Math.max(0, gust(t, 1.4)) * (0.7 + 0.3 * Math.sin(t * 2.6)),
    );
    g.save();
    g.translate(0, PADY);
    calLeaf(g, s, day, curl);
    g.restore();
    // the timeline: a signal ball run up the mast for each thing that happened, the string lowered when it is full
    const tm = t % 50;
    const n = Math.min(5, Math.floor(tm / 8) + 1);
    const low = ss(43, 49, tm);
    g.save();
    g.beginPath();
    g.rect(APEX[0] - 9, MTOP - 7, 18, APEX[1] - MTOP + 5);
    g.clip();
    for (let i = 0; i < n; i++) {
      const up = ss(0, 2.4, tm - i * 8);
      const y =
        APEX[1] + 5 + (MTOP + 10 + i * 9.4 - APEX[1] - 5) * up + low * 66;
      disc(g, APEX[0], y, 4.2);
      g.fillStyle = ballCol(s, i);
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = "rgba(255,244,214,.35)";
      disc(g, APEX[0] - 1.3, y - 1.3, 1.2);
      g.fill();
    }
    g.restore();
    glowPane(g, s, -6, -87, 12, 16, 2.2);
  },
  // the torn-off leaf fluttering down to the heap: loose of the tower, never part of its shape
  ambient(g, s) {
    const t = s.t;
    const day = Math.floor(t / PERIOD);
    const c = t - day * PERIOD;
    const k = c / 4.6;
    if (k < 1) {
      const e = Math.pow(k, 1.3);
      g.save();
      g.translate(
        HEAP[0] * e + Math.sin(k * 9) * 20 * (1 - k) + 6,
        PADY + 38 + (HEAP[1] - PADY - 42) * e,
      );
      g.rotate(Math.sin(k * 9 + 1) * 0.8 + k * 1.2);
      g.globalAlpha = Math.min(1, (1 - k) * 5);
      g.scale(
        (0.35 + 0.65 * Math.abs(Math.cos(k * 7))) * (1 - 0.6 * k),
        1 - 0.6 * k,
      );
      g.translate(0, -LH / 2);
      calLeaf(g, s, day - 1, 0.5);
      g.restore();
    }
  },
};
