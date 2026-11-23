// Settings' building on Isle: the gear mill — a stone tower mill whose sails
// are one great cog wheel, in faded paint and rust, meshing with a pinion and a
// lay gear that drive the regulator in the lean-to. It is the app at work:
// now and then a lever of the lever frame is thrown, the gear train settles to
// a new speed (the wheels really mesh: each turns at its ratio), the
// regulator's dial needle swings to the new setting, and the flyball governor
// on the roof spreads or closes with it.

import {
  accent,
  barrel,
  castShadow,
  crate,
  doorArch,
  fittings,
  grain,
  ink,
  ivy,
  mix,
  moss,
  oblique,
  planks,
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
} from "@plugins/apps/plugins/isle/plugins/buildings/core";

const {
  TAU,
  INK,
  BRASS,
  BRASS_D,
  BRASS_L,
  IRON,
  STONE,
  clamp01,
  ease,
  disc,
  seg,
  bar,
  rivet,
  drum,
  glowPane,
} = fittings;

const GRAIN_BOX: Box = [-240, -380, 270, 70];
const sstep = (u: number): number => ease(clamp01(u));

/** The gear train: the great wheel on the windshaft (teeth, pitch radius), the pinion under it, the lay gear beside the pinion. */
const HUB = [0, -236] as const;
const N1 = 24;
const P1 = 100;
const N2 = 8;
const P2 = (P1 * N2) / N1;
const G2 = [0, HUB[1] + P1 + P2] as const;
const TH3 = -0.36;
const G3 = [
  G2[0] + Math.cos(TH3) * 2 * P2,
  G2[1] + Math.sin(TH3) * 2 * P2,
] as const;
/** The regulator dial (x, y, radius), the governor's foot, the lever frame. */
const DIAL = [97, -38, 20] as const;
const GOV = [114, -97] as const;
const LEV = [-112, 20] as const;
/** The lean-to: its front wall's right edge and top, how its right side recedes (the island's depth vector), the roof's rise over that depth. */
const LR = 132;
const LT = -72;
const VX = 18;
const VY = -oblique.rise(VX);
const RISE = 22;
/** An adjustment every `D` seconds: the great wheel's speed (rad/s) after each, in a cycle of eight. */
const D = 5.5;
const VS = [0.2, 0.32, 0.14, 0.26, 0.36, 0.18, 0.3, 0.12] as const;
const speed = (n: number): number => VS[((n % 8) + 8) % 8] ?? 0.2;
/** The angle the great wheel turns through during adjustment `n` (its speed eases over the first second). */
const full = (n: number): number =>
  speed(n - 1) * D + (speed(n) - speed(n - 1)) * (D - 0.5);
const PRE = VS.map((_, k) => {
  let a = 0;
  for (let m = 0; m < k; m++) a += full(m);
  return a;
});
const SUM = (PRE[7] ?? 0) + full(7);

/** The train at time `t`: the adjustment under way and how far into it, the great wheel's speed and its angle. */
function train(t: number): { n: number; tau: number; v: number; a: number } {
  const n = Math.floor(t / D);
  const tau = t - n * D;
  const k = n % 8;
  const v0 = speed(k - 1);
  const v1 = speed(k);
  return {
    n,
    tau,
    v: v0 + (v1 - v0) * sstep(tau),
    a:
      Math.floor(n / 8) * SUM +
      (PRE[k] ?? 0) +
      v0 * tau +
      (v1 - v0) * (tau < 1 ? tau ** 3 - tau ** 4 / 2 : tau - 0.5),
  };
}

/** How many times lever `i` has been thrown before adjustment `n`. */
const thrown = (n: number, i: number): number =>
  n > i ? Math.floor((n - 1 - i) / 3) + 1 : 0;

/** A toothed wheel's outline about the origin: `n` teeth on pitch radius `pr`. */
function gearPath(
  g: Ctx2D,
  n: number,
  pr: number,
  add: number,
  ded: number,
): void {
  const st = TAU / n;
  for (let k = 0; k < n; k++) {
    const a = k * st;
    g.arc(0, 0, pr + add, a - 0.14 * st, a + 0.14 * st);
    g.arc(0, 0, pr - ded, a + 0.27 * st, a + 0.73 * st);
  }
  g.closePath();
}

/** A weathering blot on a wheel: angle, radius (0..1), its two radii, its tone (0..1). */
type Blot = readonly [number, number, number, number, number];

/** Fixed weathering for a wheel that turns (`animate` has no random stream): the same blots from the same seed. */
function blots(seed: number, n: number): Blot[] {
  let v = seed;
  const f = () => (v = (v * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: n }, (): Blot => [
    f() * TAU,
    Math.sqrt(f()),
    3 + f() * 8,
    2 + f() * 4,
    f(),
  ]);
}
const B1 = blots(7, 120);
const B2 = blots(31, 22);
const B3 = blots(57, 22);

interface CogOptions {
  /** Teeth, and the pitch radius. */
  n: number;
  pr: number;
  col: string;
  /** The radius of the open middle (0: a solid web with lightening holes), and its spokes. */
  hole: number;
  spokes: number;
  hub: number;
  bl: readonly Blot[];
}

/** How thick a cog wheel is, px of depth. */
const COG_D = 4;

/** A cog wheel centred on (x, y), turned by `ang`: its thickness going back, spokes, the toothed rim, the hub. */
function cog(g: Ctx2D, x: number, y: number, ang: number, o: CogOptions): void {
  const { n, pr, hole, col, spokes, hub, bl } = o;
  const add = 6;
  const ded = 6.5;
  const ro = pr + add;
  const P = () => {
    g.beginPath();
    gearPath(g, n, pr, add, ded);
    if (hole) {
      g.moveTo(hole, 0);
      g.arc(0, 0, hole, 0, TAU, true);
    }
  };
  // its thickness: the same outline swept back along the view's depth vector, in shade
  // (it was a drop shadow, which hung in the air wherever the wheel overhangs the tower)
  for (let d = COG_D; d >= 1; d--) {
    const [bx, by] = oblique.back([x, y], d);
    g.save();
    g.translate(bx, by);
    g.rotate(ang);
    P();
    g.fillStyle = mix(col, "#1e1a14", 0.55);
    g.fill("evenodd");
    if (d === COG_D) {
      g.strokeStyle = "rgba(48,38,28,.9)";
      g.lineWidth = 1.5;
      g.lineJoin = "round";
      g.stroke();
    }
    g.restore();
  }
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.lineJoin = "round";
  for (let k = 0; k < spokes; k++) {
    const a = (k * TAU) / spokes;
    seg(
      g,
      Math.cos(a) * hub,
      Math.sin(a) * hub,
      Math.cos(a) * (hole + 3),
      Math.sin(a) * (hole + 3),
    );
    g.lineCap = "butt";
    g.strokeStyle = "rgba(48,38,28,.88)";
    g.lineWidth = 11.4;
    g.stroke();
    g.strokeStyle = k % 2 ? "#7b6549" : "#8a7254";
    g.lineWidth = 9.2;
    g.stroke();
  }
  P();
  g.fillStyle = col;
  g.fill("evenodd");
  g.save();
  P();
  g.clip("evenodd");
  for (const [a, d, rx, ry, tn] of bl) {
    g.fillStyle =
      tn < 0.3
        ? "rgba(120,74,44,.3)"
        : tn < 0.5
          ? "rgba(118,158,140,.26)"
          : tn < 0.75
            ? "rgba(30,26,20,.14)"
            : "rgba(255,246,226,.12)";
    g.beginPath();
    g.ellipse(Math.cos(a) * d * ro, Math.sin(a) * d * ro, rx, ry, a, 0, TAU);
    g.fill();
  }
  g.restore();
  P();
  g.strokeStyle = "rgba(48,38,28,.9)";
  g.lineWidth = 1.5;
  g.stroke();
  g.strokeStyle = "rgba(48,38,28,.45)";
  g.lineWidth = 0.9;
  disc(g, 0, 0, pr - ded - 3);
  g.stroke();
  if (hole) {
    disc(g, 0, 0, hole + 3.4);
    g.stroke();
  }
  for (let k = 0; k < n; k++) {
    const a = (k * TAU) / n;
    rivet(g, Math.cos(a) * (pr - 1) - 0.5, Math.sin(a) * (pr - 1) - 0.5, 0.9);
  }
  if (!hole)
    for (let k = 0; k < 3; k++) {
      const a = (k * TAU) / 3 + 0.5;
      disc(g, Math.cos(a) * pr * 0.52, Math.sin(a) * pr * 0.52, pr * 0.17);
      g.fillStyle = "rgba(26,22,18,.7)";
      g.fill();
      g.strokeStyle = "rgba(48,38,28,.8)";
      g.lineWidth = 1;
      g.stroke();
    }
  disc(g, 0, 0, hub);
  g.fillStyle = BRASS;
  g.fill();
  g.strokeStyle = "rgba(48,38,28,.9)";
  g.lineWidth = 1.3;
  g.stroke();
  for (let k = 0; k < 4; k++) {
    const a = (k * TAU) / 4 + 0.4;
    rivet(
      g,
      Math.cos(a) * hub * 0.62 - 0.5,
      Math.sin(a) * hub * 0.62 - 0.5,
      0.9,
    );
  }
  disc(g, 0, 0, hub * 0.3);
  g.fillStyle = IRON;
  g.fill();
  g.restore();
  // fixed light: a glint on the upper-left rim, shade on the lower right
  g.lineCap = "round";
  g.strokeStyle = "rgba(255,248,226,.3)";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(x, y, pr - ded - 1, Math.PI * 1.05, Math.PI * 1.5);
  g.stroke();
  g.strokeStyle = "rgba(24,20,14,.26)";
  g.lineWidth = 2.6;
  g.beginPath();
  g.arc(x, y, pr - ded - 1, 0.1, Math.PI * 0.55);
  g.stroke();
}

export const gearMill: BuildingSpec = {
  door: { kind: "leaf", w: 34, h: 60, arch: true },
  footprint: {
    w: 270,
    depth: 86,
    ground: [-183, -112, 239, 55],
    upper: [-109, -355, 141, -112],
  },
  setting: ["hill"],
  signX: 206,
  lights: [
    [0, -30, 18],
    [0, -196, 14],
    [DIAL[0], DIAL[1], 16],
    [-42, -44, 12],
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const A = accent(s.hue);
    castShadow(
      g,
      [
        [-56, 7],
        [134, 6],
        [214, 34],
        [230, -8],
        [138, -58],
      ],
      0.28,
    );
    // the lean-to that houses the regulator: boards on a stone footing, a shake roof
    // (its right side recedes along the island's one depth vector, in shade, up to the rising verge of the roof)
    oblique.onSide(g, LR, () => {
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(VX, 0);
      g.lineTo(VX, LT - RISE + 9);
      g.lineTo(0, LT);
      g.closePath();
      g.save();
      g.clip();
      planks(g, 0, LT - RISE, VX, -11, r, { base: "#8a7253", pw: 6 });
      stones(g, 0, -14, VX + 3, 0, r, { rowH: 7, blockW: 12, base: "#a59d8b" });
      g.fillStyle = "rgba(24,18,10,.4)";
      g.fillRect(0, LT - RISE, VX + 3, RISE - LT);
      g.restore();
      ink(g, 1.1, 0.8);
      g.stroke();
    });
    planks(g, 58, LT, LR, -11, r, { base: "#8a7253", pw: 8 });
    stones(g, 55, -14, LR + 3, 0, r, { rowH: 7, blockW: 15, base: "#a59d8b" });
    shingles(
      g,
      [
        [50, LT + 6],
        [LR + 9, LT + 6],
        [LR + 9 + VX, LT + 6 + VY - RISE],
        [50 + VX, LT + 6 + VY - RISE],
      ],
      r,
      { base: "#7c6a58", rowH: 6.5, w: 10 },
    );
    seg(g, LR + 9, LT + 6, LR + 9 + VX, LT + 6 + VY - RISE);
    bar(g, 3, "#5e4c3a", "rgba(255,240,210,.2)");
    // the tower: a battered stone drum under a shake cap
    shingles(
      g,
      [
        [-46, -298],
        [46, -298],
        [30, -338],
        [0, -352],
        [-30, -338],
      ],
      r,
      { base: "#75644f", rowH: 6.5, w: 10 },
    );
    drum(g, r, {
      rb: 64,
      rt: 42,
      yb: -11,
      yt: -300,
      ey: 11,
      row: 9,
      joint: 0.24,
      top: null,
      tone: STONE,
    });
    windowRect(g, -9, -182, 18, 30, r, {
      arch: true,
      lit,
      frame: "#4a3a2c",
      sill: "#a49d8c",
    });
    windowRect(g, -52, -30, 20, 30, r, {
      arch: true,
      lit,
      frame: "#4a3a2c",
      sill: "#a49d8c",
    });
    doorArch(g, 0, 0, 34, 60, r, { col: A });
    steps(g, 0, 2, 40, 1, r);
    // bearings: the windshaft's iron boss, a strap for the pinion, a timber bracket out to the lay gear
    disc(g, HUB[0], HUB[1], 23);
    g.fillStyle = IRON;
    g.fill();
    ink(g, 1.2);
    g.stroke();
    g.fillStyle = IRON;
    g.fillRect(-5, G2[1] - 46, 10, 92);
    ink(g, 0.9, 0.8);
    g.strokeRect(-5, G2[1] - 46, 10, 92);
    for (const dy of [-42, -34, 34, 41]) rivet(g, -1, G2[1] + dy, 1);
    seg(g, 36, G2[1] - 42, G3[0] + 10, G3[1]);
    bar(g, 6.4, "#6e573f", "rgba(255,240,210,.25)");
    seg(g, 48, G2[1] + 12, G3[0] + 5, G3[1] + 3);
    bar(g, 4, "#7b6549", null);
    // the regulator dial on the lean-to (its needle moves: see animate)
    const [dx, dy, dr] = DIAL;
    disc(g, dx, dy, dr + 4);
    g.fillStyle = BRASS_D;
    g.fill();
    ink(g, 1.3);
    g.stroke();
    disc(g, dx, dy, dr + 1.6);
    g.strokeStyle = "rgba(226,204,150,.5)";
    g.lineWidth = 1;
    g.stroke();
    wash(
      g,
      () => disc(g, dx, dy, dr),
      [dx - dr, dy - dr, dx + dr, dy + dr],
      lit ? "#f0dca0" : "#d8cfb4",
      r,
      { blob: 4, var: 14, shadeA: 0.16, lw: 0.9 },
    );
    for (let k = 0; k <= 12; k++) {
      const a = -Math.PI * 0.9 + (k * Math.PI * 0.8) / 12;
      const len = k % 3 ? 4.4 : 6.6;
      ink(g, k % 3 ? 0.7 : 1.3, 0.75);
      seg(
        g,
        dx + Math.cos(a) * (dr - 1.8),
        dy + Math.sin(a) * (dr - 1.8),
        dx + Math.cos(a) * (dr - len),
        dy + Math.sin(a) * (dr - len),
      );
      g.stroke();
    }
    g.strokeStyle = "rgba(140,74,58,.7)";
    g.lineWidth = 1.8;
    g.beginPath();
    g.arc(dx, dy, dr - 4, -Math.PI * 0.3, -Math.PI * 0.1);
    g.stroke();
    // the governor's stand on the roof
    seg(g, GOV[0], GOV[1] + 8, GOV[0], GOV[1] - 28);
    bar(g, 2.6, BRASS, BRASS_L);
    g.fillStyle = IRON;
    g.fillRect(GOV[0] - 7, GOV[1] + 3, 14, 7);
    ink(g, 0.9);
    g.strokeRect(GOV[0] - 7, GOV[1] + 3, 14, 7);
    // the lever frame, and its rod to the mill
    const [lx, ly] = LEV;
    castShadow(
      g,
      [
        [lx - 28, ly + 4],
        [lx + 28, ly + 4],
        [lx + 38, ly + 10],
        [lx - 18, ly + 10],
      ],
      0.28,
    );
    g.beginPath();
    g.moveTo(lx + 25, ly - 1);
    g.lineTo(-74, 11);
    g.lineTo(-58, 0);
    bar(g, 2, IRON, null);
    // (the frame's sill is a baulk of timber: its top and its end show)
    oblique.solid(
      g,
      { x0: lx - 28, x1: lx + 28, yb: ly + 4, yt: ly - 6, d: 9 },
      {
        side: (d, yt, yb) => {
          g.fillStyle = "#5e4b34";
          g.fillRect(0, yt, d, yb - yt);
        },
        top: (x0, x1, d) => {
          g.fillStyle = "#8f7858";
          g.fillRect(x0, 0, x1 - x0, d);
        },
        front: () =>
          planks(g, lx - 28, ly - 6, lx + 28, ly + 4, r, {
            base: "#7d6648",
            vertical: false,
            pw: 5,
          }),
        shade: 0.1,
        ink: 1,
      },
    );
    for (const k of [-1, 0, 1]) {
      const x = lx + k * 17;
      g.beginPath();
      g.arc(x, ly - 4, 13, Math.PI * 1.15, Math.PI * 1.85);
      g.strokeStyle = IRON;
      g.lineWidth = 2.8;
      g.stroke();
      ink(g, 0.6, 0.6);
      for (let a = Math.PI * 1.2; a < Math.PI * 1.85; a += 0.22) {
        seg(
          g,
          x + Math.cos(a) * 11.6,
          ly - 4 + Math.sin(a) * 11.6,
          x + Math.cos(a) * 14.4,
          ly - 4 + Math.sin(a) * 14.4,
        );
        g.stroke();
      }
    }
    // a spare wheel against the wall, an oil drum
    g.save();
    g.translate(-76, -5);
    g.scale(1, 0.94);
    g.rotate(0.3);
    g.beginPath();
    gearPath(g, 10, 16, 3, 3.2);
    g.moveTo(6, 0);
    g.arc(0, 0, 6, 0, TAU, true);
    g.fillStyle = "#57534c";
    g.fill("evenodd");
    ink(g, 1.1);
    g.stroke();
    g.restore();
    barrel(g, 152, 10, 9, r);
    crate(g, -174, 36, 15, r);
    moss(g, -62, 132, 0, r, 18);
    tufts(g, -64, -22, 4, r, 7);
    tufts(g, 28, 134, 4, r, 12);
    tufts(g, -170, -84, 36, r, 10);
    ivy(g, -54, -6, -92, r, 14);
    for (const [x, y, z, k] of [
      [-160, -2, 15, 0],
      [184, -14, 13, 1],
      [52, 48, 9, 2],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    const T = train(t);
    const a1 = T.a;
    // the gear train: the great cog wheel where the sails would be, its pinion, the lay gear that drives the regulator
    const a2 = Math.PI / 2 + Math.PI - (Math.PI - (Math.PI / 2 - a1) * N1) / N2;
    const a3 = TH3 + Math.PI - (Math.PI - (TH3 - a2) * N2) / N2;
    cog(g, G3[0], G3[1], a3, {
      n: N2,
      pr: P2,
      col: "#5d5952",
      hole: 0,
      spokes: 0,
      hub: 7.5,
      bl: B3,
    });
    cog(g, G2[0], G2[1], a2, {
      n: N2,
      pr: P2,
      col: mix(BRASS_D, "#5d5952", 0.4),
      hole: 0,
      spokes: 0,
      hub: 7.5,
      bl: B2,
    });
    cog(g, HUB[0], HUB[1], a1, {
      n: N1,
      pr: P1,
      col: mix(accent(s.hue), "#6a6a66", 0.35),
      hole: 70,
      spokes: 8,
      hub: 18,
      bl: B1,
    });
    // the levers: one is thrown at each adjustment
    const [lx, ly] = LEV;
    const j = T.n % 3;
    const lean = (c: number) => (c % 2 ? 0.42 : -0.42);
    for (const i of [0, 1, 2]) {
      const a =
        i === j
          ? lean(thrown(T.n, i)) +
            (lean(thrown(T.n + 1, i)) - lean(thrown(T.n, i))) *
              sstep(T.tau / 0.6)
          : lean(thrown(T.n + 1, i));
      g.save();
      g.translate(lx + (i - 1) * 17, ly - 4);
      g.rotate(a);
      seg(g, 0, 0, 0, -37);
      bar(g, 3, IRON, "rgba(220,220,210,.3)");
      seg(g, 0, -30, 0, -41);
      bar(g, 4.4, i === j ? BRASS_L : BRASS, null);
      g.restore();
    }
    // the regulator dial: the needle swings to the new setting and settles
    const [dx, dy, dr] = DIAL;
    const na =
      -Math.PI * 0.9 +
      (Math.PI * 0.8 * (T.v - 0.1)) / 0.28 +
      0.14 * Math.exp(-T.tau * 1.8) * Math.sin(T.tau * 8) +
      0.012 * Math.sin(t * 6.1);
    g.save();
    g.lineCap = "round";
    g.strokeStyle = "#5a2a22";
    g.lineWidth = 1.8;
    seg(
      g,
      dx - Math.cos(na) * 4,
      dy - Math.sin(na) * 4,
      dx + Math.cos(na) * (dr - 4),
      dy + Math.sin(na) * (dr - 4),
    );
    g.stroke();
    disc(g, dx, dy, 2.6);
    g.fillStyle = BRASS_D;
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 0.8;
    g.stroke();
    g.restore();
    // the flyball governor on the lean-to roof: the faster the mill, the wider it swings
    const sp = 4 + 42 * T.v;
    const ph = a1 * 7;
    const gy = GOV[1] - 27;
    const balls = [ph, ph + Math.PI]
      .map((p) => [Math.cos(p), Math.sin(p)] as const)
      .sort((p, q) => p[1] - q[1]);
    for (const [cx, sz] of balls) {
      const bx = GOV[0] + cx * sp;
      const by = gy + 22 - sp * 0.55 + sz * 1.6;
      g.strokeStyle = INK;
      g.lineWidth = 1.2;
      seg(g, GOV[0], gy, bx, by);
      g.stroke();
      disc(g, bx, by, 4.2);
      g.fillStyle = sz > 0 ? BRASS : BRASS_D;
      g.fill();
      g.stroke();
    }
    disc(g, GOV[0], gy, 2.4);
    g.fillStyle = BRASS_L;
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 0.8;
    g.stroke();
    glowPane(g, s, -7, -210, 14, 26, 0.9);
    glowPane(g, s, -50, -58, 16, 26, 2.4);
    glowPane(g, s, dx, dy, dr, null, 1.4);
  },
};
