// Deploy's building on Isle: the rocket itself — riveted tinplate with a
// copper belt, its nose in faded launch-pad paint, the door in its skirt
// between the fins — standing on a flagstone pad beside its timber-and-iron
// gantry. It is the app at work: the countdown semaphore drops a notch at a
// time, and at the bottom the engines are tested (a short burst of steam
// rolling out over the pad — never a launch: the building stays); a crate is
// hoisted up the rope, run in along the jib and set down on the stage; the
// tank vents through its relief valve.

import {
  accent,
  barrel,
  bbox,
  castShadow,
  crate,
  dark,
  doorArch,
  fittings,
  grain,
  hline,
  ink,
  jit,
  lantern,
  light,
  mix,
  moss,
  oblique,
  planks,
  poly,
  shrub,
  steps,
  stones,
  tufts,
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
  BRASS_L,
  IRON,
  clamp01,
  ease,
  disc,
  seg,
  ellShadow,
  bar,
  rivet,
  streaks,
  porthole,
  metal,
  ring,
  paving,
  gust,
  glowPane,
  cloth,
  puff,
} = fittings;

const COPPER = "#9a6c4a";
const GRAIN_BOX: Box = [-250, -440, 260, 70];
const sstep = (u: number): number => ease(clamp01(u));

/** The rocket: its half width, the y of its nose tip, of the nose's base and of the skirt's top. */
const HW = 43;
const TIP = -400;
const NB = -270;
const SKIRT = -50;
/** The gantry: its two posts' x, its top, its stage; the semaphore mast's x; the hoist rope's x at rest and over the stage. */
/** How deep the gantry is: its right face recedes that far. */
const GD = 20;
const GX0 = 80;
const GX1 = 132;
const GT = -350;
const STAGE = -254;
const MX = -120;
const HOIST = 184;
const HOIST_IN = 106;
/** The countdown: its cycle (s), the time between notches, when the engine test starts. */
const CYC = 19;
const STEP = 2.6;
const PUFF0 = 3 * STEP + 1.2;

/** The rocket's half width at height `y`. */
function hw(y: number): number {
  if (y > SKIRT) return HW + (4 * (y - SKIRT)) / -SKIRT;
  if (y > NB) return HW;
  return HW * Math.sqrt(Math.max(0, 1 - ((NB - y) / (NB - TIP)) ** 1.7));
}

function bodyPath(g: Ctx2D): void {
  g.beginPath();
  g.moveTo(-hw(-4), -4);
  for (let y = -10; y > TIP; y -= 6) g.lineTo(-hw(y), y);
  g.lineTo(0, TIP);
  for (let y = TIP + 4; y < -4; y += 6) g.lineTo(hw(y), y);
  g.lineTo(hw(-4), -4);
  g.ellipse(0, -4, hw(-4), 7, 0, 0, Math.PI);
  g.closePath();
}

/** A band round the rocket between two heights, as a path. */
function beltPath(g: Ctx2D, y0: number, y1: number): void {
  const w = HW + 4;
  g.beginPath();
  g.moveTo(-w, y0);
  g.lineTo(-w, y1);
  g.ellipse(0, y1, w, 7, 0, Math.PI, 0, true);
  g.lineTo(w, y0);
  g.ellipse(0, y0, w, 7, 0, 0, Math.PI);
  g.closePath();
}

export const rocketPad: BuildingSpec = {
  door: { kind: "leaf", w: 34, h: 60, head: 17 },
  footprint: {
    w: 264,
    depth: 84,
    ground: [-200, -112, 256, 61],
    upper: [-160, -423, 210, -112],
  },
  setting: ["cape", "coast"],
  signX: -236,
  lights: [
    [0, -30, 18],
    [0, -208, 15],
    [0, -122, 14],
    [98, -322, 13],
    [MX, -80, 10],
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const A = accent(s.hue);
    const NOSE = mix(A, s.hue, 0.3);
    const TIN = "#b1a992";
    const FIN = "#6b6860";
    paving(g, r, 10, 3, 162, 40);
    g.save();
    g.beginPath();
    g.ellipse(10, 3, 162, 40, 0, 0, TAU);
    g.clip();
    for (const x of [-64, 64])
      for (let k = 0; k < 22; k++) {
        g.fillStyle = `rgba(34,28,22,${0.05 + r() * 0.1})`;
        g.beginPath();
        g.ellipse(
          x + (r() - 0.5) * 70,
          3 + (r() - 0.5) * 22,
          5 + r() * 16,
          2 + r() * 6,
          0,
          0,
          TAU,
        );
        g.fill();
      }
    g.restore();
    castShadow(
      g,
      [
        [-42, 8],
        [50, 8],
        [210, 42],
        [246, 16],
        [168, -14],
        [84, -30],
      ],
      0.26,
    );
    // the gantry: timber posts and braces, iron at the joints, a jib for the hoist
    const girts = [-78, -166, STAGE, -342] as const;
    // its right face, receding (drawn first: it is behind): the far post, the girts and braces between
    oblique.onSide(g, GX1, () => {
      for (let i = 0; i < girts.length - 1; i++) {
        const y0 = girts[i] ?? 0;
        const y1 = girts[i + 1] ?? 0;
        seg(g, 0, y0, GD, y1);
        bar(g, 2, "#6e5a42", null);
        seg(g, GD, y0, 0, y1);
        bar(g, 2, "#62503a", null);
      }
      seg(g, 0, 0, GD, -78);
      bar(g, 2, "#6e5a42", null);
      seg(g, GD, 0, 0, -78);
      bar(g, 2, "#62503a", null);
      seg(g, GD, 0, GD, GT);
      bar(g, 5.6, "#665238", null);
      for (const y of girts) {
        seg(g, 0, y, GD + 3, y);
        bar(g, 3.8, "#5a4733", null);
      }
    });
    // the stage's deck, seen from above
    oblique.onTop(g, STAGE - 6, () => {
      g.fillStyle = "#77654a";
      g.fillRect(GX0 - 14, 0, GX1 - GX0 + 26, GD);
      ink(g, 0.7, 0.5);
      for (let v = 5; v < GD; v += 5) {
        seg(g, GX0 - 14, v, GX1 + 12, v);
        g.stroke();
      }
      ink(g, 1, 0.8);
      g.strokeRect(GX0 - 14, 0, GX1 - GX0 + 26, GD);
    });
    const deckEnd = oblique.sideFace(GX1 + 12, STAGE, STAGE - 6, GD);
    oblique.fill(g, deckEnd, (pts) => {
      g.fillStyle = "#5e4d38";
      poly(g, pts);
      g.fill();
    });
    oblique.inkFace(g, deckEnd, 1, 0.8);
    for (let i = 0; i < girts.length - 1; i++) {
      const y0 = girts[i] ?? 0;
      const y1 = girts[i + 1] ?? 0;
      seg(g, GX0, y0, GX1, y1);
      bar(g, 2.2, "#8a7254", null);
      seg(g, GX1, y0, GX0, y1);
      bar(g, 2.2, "#7b6549", null);
    }
    seg(g, GX0, 0, GX1, -78);
    bar(g, 2.2, "#8a7254", null);
    seg(g, GX1, 0, GX0, -78);
    bar(g, 2.2, "#7b6549", null);
    for (let y = -10; y > STAGE; y -= 8) {
      ink(g, 1, 0.7);
      seg(g, GX1 - 18, y, GX1 - 6, y);
      g.stroke();
    }
    seg(g, GX1 - 18, -4, GX1 - 18, STAGE);
    bar(g, 1.3, "#5a4a3a", null);
    for (const [x, y] of [
      [GX0, 0],
      [GX1, 0],
    ] as const) {
      seg(g, x, y, x, GT);
      bar(g, 6.4, "#7d6648", "rgba(255,240,210,.28)");
    }
    for (const y of girts) {
      seg(g, GX0 - 4, y, GX1 + 4, y);
      bar(g, 4.4, "#6e573f", "rgba(255,240,210,.22)");
      for (const x of [GX0, GX1]) {
        g.fillStyle = IRON;
        g.fillRect(x - 5, y - 5, 10, 10);
        ink(g, 0.8, 0.8);
        g.strokeRect(x - 5, y - 5, 10, 10);
        for (const [dx, dy] of [
          [-3, -3],
          [1.6, -3],
          [-3, 1.6],
          [1.6, 1.6],
        ] as const)
          rivet(g, x + dx, y + dy, 0.8);
      }
    }
    // grime on the timbers only: the lattice is open, and a streak across a gap hung in the air
    g.save();
    g.globalCompositeOperation = "source-atop";
    streaks(g, r, [GX0 - 4, GT, GX1 + 4, -10], 12, "40,34,26", 0.12, 50);
    g.restore();
    // the stage and its rail, the access arm and the fuel hose to the rocket
    planks(g, GX0 - 14, STAGE - 6, GX1 + 12, STAGE, r, {
      base: "#8a7558",
      vertical: false,
      pw: 6,
    });
    seg(g, GX0 - 12, STAGE - 22, GX1 + 12, STAGE - 22);
    bar(g, 1.5, "#5a4a3a", null);
    for (const x of [GX0 - 12, GX0 + 14, GX1 - 14, GX1 + 12]) {
      seg(g, x, STAGE - 6, x, STAGE - 22);
      bar(g, 1.5, "#5a4a3a", null);
    }
    seg(g, GX0 - 14, STAGE - 3, 38, STAGE - 3);
    bar(g, 4, "#7d6648", "rgba(255,240,210,.25)");
    seg(g, GX0 - 12, STAGE - 20, 40, STAGE - 20);
    bar(g, 1.4, "#5a4a3a", null);
    g.beginPath();
    g.moveTo(GX0, -166);
    g.quadraticCurveTo(62, -132, 42, -158);
    bar(g, 3, "#4a443c", "rgba(220,220,210,.2)");
    seg(g, GX0 - 8, GT, 204, GT);
    bar(g, 6, "#6e573f", "rgba(255,240,210,.25)");
    seg(g, GX1, GT + 48, 194, GT + 3);
    bar(g, 3, "#7b6549", null);
    seg(g, GX1, GT, GX1, GT - 30);
    bar(g, 4, "#7d6648", null);
    ink(g, 0.9, 0.75);
    seg(g, GX1, GT - 28, 200, GT - 3);
    g.stroke();
    seg(g, GX1, GT - 28, GX0 - 6, GT - 3);
    g.stroke();
    lantern(g, 98, -322, lit);
    ink(g, 0.9);
    seg(g, 98, -334, 98, GT + 3);
    g.stroke();
    // the engine bells and the fins
    for (const k of [-1, 1]) {
      poly(g, [
        [k * 54, -32],
        [k * 72, -32],
        [k * 80, -4],
        [k * 48, -4],
      ]);
      const bg = g.createLinearGradient(k * 48, 0, k * 80, 0);
      bg.addColorStop(0, k < 0 ? "#6a655e" : "#4a4640");
      bg.addColorStop(1, k < 0 ? "#3c3934" : "#2c2a27");
      g.fillStyle = bg;
      g.fill();
      ink(g, 1.2);
      g.stroke();
      ink(g, 0.7, 0.5);
      for (const y of [-24, -14])
        hline(
          g,
          k * (52 - (y + 32) * 0.2),
          y,
          k * (74 + (y + 32) * 0.28),
          y,
          r,
          0.4,
        );
      g.fillStyle = "#1c1917";
      g.beginPath();
      g.ellipse(k * 64, -4, 16, 3.6, 0, 0, TAU);
      g.fill();
      ink(g, 0.9);
      g.stroke();
    }
    for (const k of [-1, 1]) {
      const fin: Pt[] = [
        [k * 40, -140],
        [k * 94, -46],
        [k * 94, -16],
        [k * 43, -34],
      ];
      metal(
        g,
        r,
        () => poly(g, fin),
        bbox(fin),
        k < 0 ? FIN : dark(FIN, 0.22),
        {
          verd: 0.22,
          bare: 0.14,
          lw: 1.5,
          inside: () => {
            ink(g, 0.7, 0.45);
            hline(g, k * 56, -110, k * 58, -30, r, 0.5);
            hline(g, k * 75, -78, k * 76, -24, r, 0.5);
            hline(g, k * 43, -62, k * 94, -40, r, 0.5);
            for (let y = -128; y < -40; y += 8) rivet(g, k * 45 - 0.5, y, 0.9);
            for (let x = 48; x < 92; x += 8)
              rivet(g, k * x, -37 + (x - 43) * 0.35 - 6, 0.9);
          },
        },
      );
    }
    // the rocket: riveted tinplate, the nose in faded launch-pad paint, a copper belt
    metal(g, r, () => bodyPath(g), [-HW - 4, TIP, HW + 4, 4], TIN, {
      verd: 0.08,
      bare: 0.2,
      bareCol: "120,84,54",
      streaks: 16,
      inside: () => {
        g.beginPath();
        g.moveTo(-HW - 4, TIP - 2);
        g.lineTo(-HW - 4, NB);
        g.ellipse(0, NB, HW + 4, 7, 0, Math.PI, 0, true);
        g.lineTo(HW + 4, TIP - 2);
        g.closePath();
        g.save();
        g.clip();
        const ng = g.createLinearGradient(-HW, 0, HW, 0);
        ng.addColorStop(0, light(NOSE, 0.18));
        ng.addColorStop(0.4, NOSE);
        ng.addColorStop(1, dark(NOSE, 0.42));
        g.fillStyle = ng;
        g.fillRect(-HW - 4, TIP - 2, 2 * HW + 8, NB - TIP + 10);
        for (let i = 0; i < 90; i++) {
          g.fillStyle =
            r() < 0.3
              ? `rgba(70,40,30,${0.12 + r() * 0.2})`
              : jit(NOSE, r, 36, 0.24);
          g.beginPath();
          g.ellipse(
            -HW + r() * 2 * HW,
            TIP + r() * (NB - TIP),
            3 + r() * 8,
            2 + r() * 6,
            r() * 3,
            0,
            TAU,
          );
          g.fill();
        }
        streaks(g, r, [-HW, TIP + 24, HW, NB], 10, "40,30,26", 0.13, 50);
        ink(g, 0.7, 0.4);
        for (const u of [-0.55, 0, 0.55]) {
          g.beginPath();
          g.moveTo(0, TIP);
          g.quadraticCurveTo(
            u * HW * 1.1,
            TIP + 60,
            u * HW,
            NB + 7 * Math.sqrt(1 - u * u),
          );
          g.stroke();
        }
        g.restore();
        ink(g, 1, 0.6);
        ring(g, NB, HW + 1, 7);
        g.stroke();
        for (let a = 0.14; a < Math.PI; a += 0.2)
          rivet(g, Math.cos(a) * HW * 0.98, NB + Math.sin(a) * 7 + 2.4, 0.85);
        beltPath(g, -184, -166);
        const cg = g.createLinearGradient(-HW, 0, HW, 0);
        cg.addColorStop(0, light(COPPER, 0.2));
        cg.addColorStop(0.4, COPPER);
        cg.addColorStop(1, dark(COPPER, 0.45));
        g.fillStyle = cg;
        g.fill();
        ink(g, 0.9, 0.7);
        g.stroke();
        for (let k = 0; k < 16; k++) {
          g.fillStyle = `rgba(118,158,140,${0.25 + r() * 0.3})`;
          g.beginPath();
          g.ellipse(
            -HW + r() * 2 * HW,
            -180 + r() * 16,
            2 + r() * 4,
            1.5 + r() * 2,
            0,
            0,
            TAU,
          );
          g.fill();
        }
        for (const y of [-336, -240, -212, -140, -96, SKIRT]) {
          const w = hw(y);
          const ry = (7 * w) / HW;
          ink(g, 0.8, 0.45);
          ring(g, y, w, ry);
          g.stroke();
          for (let a = 0.14; a < Math.PI; a += 0.2)
            rivet(g, Math.cos(a) * w * 0.98, y + Math.sin(a) * ry - 3.4, 0.85);
        }
        ink(g, 0.7, 0.4);
        for (const x of [-22, 23]) {
          hline(g, x, -240, x, -212, r, 0.4);
          hline(g, x + 4, -140, x + 4, -96, r, 0.4);
          hline(g, x - 3, -96, x - 3, SKIRT, r, 0.4);
        }
        hline(g, 1, -212, 1, -186, r, 0.4);
        const sk = g.createLinearGradient(0, SKIRT, 0, 4);
        sk.addColorStop(0, "rgba(40,36,32,.15)");
        sk.addColorStop(1, "rgba(40,36,32,.6)");
        g.fillStyle = sk;
        g.fillRect(-HW - 4, SKIRT + 2, 2 * HW + 8, -SKIRT + 6);
        const hl = g.createLinearGradient(-HW, 0, HW, 0);
        hl.addColorStop(0.1, "rgba(255,250,232,0)");
        hl.addColorStop(0.27, "rgba(255,250,232,.24)");
        hl.addColorStop(0.45, "rgba(255,250,232,0)");
        g.fillStyle = hl;
        g.fillRect(-HW - 4, TIP, 2 * HW + 8, -TIP + 6);
      },
    });
    seg(g, 0, TIP + 2, 0, TIP - 16);
    bar(g, 2.4, BRASS, BRASS_L);
    disc(g, 0, TIP - 17, 3.2);
    g.fillStyle = BRASS;
    g.fill();
    ink(g, 0.9);
    g.stroke();
    porthole(g, 0, -208, 11, lit);
    porthole(g, 0, -122, 10, lit);
    g.fillStyle = BRASS_D;
    g.fillRect(-HW - 6, -172, 9, 9);
    ink(g, 0.9);
    g.strokeRect(-HW - 6, -172, 9, 9);
    doorArch(g, 0, 0, 34, 60, r, {
      col: mix(A, "#5a4a3a", 0.35),
      surround: false,
    });
    g.beginPath();
    g.moveTo(-18.5, 0);
    g.lineTo(-18.5, -43);
    g.arc(0, -43, 18.5, Math.PI, 0);
    g.lineTo(18.5, 0);
    g.strokeStyle = IRON;
    g.lineWidth = 3;
    g.stroke();
    for (let a = Math.PI; a < TAU + 0.01; a += Math.PI / 8)
      rivet(g, Math.cos(a) * 18.5 - 0.4, -43 + Math.sin(a) * 18.5 - 0.4, 0.8);
    for (let y = -38; y < -2; y += 8) {
      rivet(g, -18.9, y, 0.8);
      rivet(g, 18.1, y, 0.8);
    }
    steps(g, 0, 2, 38, 1, r);
    // the countdown semaphore's mast
    ellShadow(g, MX + 8, 12, 13, 3.6, 0.3);
    stones(g, MX - 9, 3, MX + 9, 12, r, {
      rowH: 4.5,
      blockW: 8,
      base: "#a59d8b",
    });
    seg(g, MX, 4, MX, -122);
    bar(g, 4.6, "#7d6648", "rgba(255,240,210,.3)");
    g.fillStyle = IRON;
    g.fillRect(MX - 6, -88, 12, 15);
    ink(g, 0.9);
    g.strokeRect(MX - 6, -88, 12, 15);
    disc(g, MX, -80.5, 3.6);
    g.fillStyle = lit ? "#ffd27a" : "#8c4a3a";
    g.fill();
    ink(g, 0.7);
    g.stroke();
    for (let y = -6; y > -68; y -= 7) {
      ink(g, 0.9, 0.7);
      seg(g, MX - 5, y, MX + 5, y);
      g.stroke();
    }
    // stores waiting for the hoist, fuel drums
    crate(g, 204, 32, 17, r);
    crate(g, 210, 14, 14, r);
    crate(g, 228, 36, 13, r);
    barrel(g, -72, 28, 9, r);
    barrel(g, -94, 20, 9, r);
    moss(g, -84, 154, 4, r, 16);
    tufts(g, -154, -56, 30, r, 11);
    tufts(g, 70, 182, 40, r, 11);
    for (const [x, y, z, k] of [
      [-180, 2, 15, 1],
      [178, -20, 12, 0],
      [34, 54, 9, 2],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    const c = t % CYC;
    // the countdown semaphore: the arm drops a notch at a time; at the bottom the engines are tested; then it is hauled back up
    const pos = Math.min(3, Math.floor(c / STEP));
    const tau = c - pos * STEP;
    const ang = (p: number) => -0.95 + p * 0.63;
    let a =
      pos === 0
        ? ang(0)
        : ang(pos - 1) +
          (ang(pos) - ang(pos - 1)) * sstep(tau / 0.35) +
          0.08 * Math.exp(-tau * 3.5) * Math.sin(tau * 16);
    if (c > CYC - 2)
      a = ang(3) + (ang(0) - ang(3)) * sstep((c - CYC + 2) / 1.6);
    g.save();
    g.translate(MX, -110);
    g.scale(-1, 1);
    g.rotate(a);
    g.lineJoin = "round";
    poly(g, [
      [-13, -3],
      [6, -4.2],
      [37, -6.6],
      [33, 0],
      [37, 6.6],
      [6, 4.2],
      [-13, 3],
    ]);
    g.fillStyle = "#d8cfb4";
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1.1;
    g.stroke();
    g.fillStyle = "#8c4a3a";
    g.fillRect(20, -5.2, 7, 10.4);
    disc(g, -10, 0, 4.8);
    g.fillStyle = IRON;
    g.fill();
    g.stroke();
    g.restore();
    disc(g, MX, -110, 3);
    g.fillStyle = BRASS;
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 0.9;
    g.stroke();
    // the hoist: a crate goes up the rope, is run in along the jib and set down on the stage; the hook comes back for the next
    const h = t % 25;
    const GY = 30;
    const TOPY = -296;
    const DROP = STAGE - 6 - TOPY;
    const e2 = (a0: number, a1: number) => sstep((h - a0) / (a1 - a0));
    const hy =
      h < 1.5
        ? GY
        : h < 9.5
          ? GY + (TOPY - GY) * e2(1.5, 9.5)
          : h < 12.5
            ? TOPY
            : h < 13.5
              ? TOPY + DROP * e2(12.5, 13.5)
              : h < 14.5
                ? TOPY + DROP
                : h < 15.5
                  ? TOPY + DROP - DROP * e2(14.5, 15.5)
                  : h < 18
                    ? TOPY
                    : TOPY + (GY - TOPY) * e2(18, 24.2);
    const hx =
      h < 9.5
        ? HOIST
        : h < 12.5
          ? HOIST + (HOIST_IN - HOIST) * e2(9.5, 12.5)
          : h < 15.5
            ? HOIST_IN
            : h < 18
              ? HOIST_IN + (HOIST - HOIST_IN) * e2(15.5, 18)
              : HOIST;
    const load =
      h < 13.5 ? Math.min(1, h / 0.8) : h < 14.5 ? 1 - e2(13.5, 14.5) : 0;
    const sway = Math.sin(t * 1.3) * 2.2 * (h > 1.5 && h < 12.5 ? 1 : 0.4);
    g.strokeStyle = INK;
    g.lineWidth = 1.1;
    seg(g, hx, GT + 5, hx + sway, hy - 27);
    g.stroke();
    g.fillStyle = IRON;
    g.fillRect(hx - 5, GT - 2, 10, 8);
    g.strokeRect(hx - 5, GT - 2, 10, 8);
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(hx + sway, hy - 23.6, 3.2, -1.3, 2.6);
    g.stroke();
    if (load > 0.02) {
      const x = hx + sway;
      const y = hy;
      g.save();
      g.globalAlpha = load;
      g.strokeStyle = INK;
      g.lineWidth = 0.9;
      seg(g, x, y - 21, x - 9, y - 16);
      g.stroke();
      seg(g, x, y - 21, x + 9, y - 16);
      g.stroke();
      oblique.solid(
        g,
        { x0: x - 9, x1: x + 9, yb: y, yt: y - 18, d: 5 },
        {
          side: (d, yt, yb) => {
            g.fillStyle = "#8a7050";
            g.fillRect(0, yt, d, yb - yt);
          },
          top: (x0, x1, d) => {
            g.fillStyle = "#b49a72";
            g.fillRect(x0, 0, x1 - x0, d);
          },
          front: () => {
            g.fillStyle = "#a08460";
            g.fillRect(x - 9, y - 18, 18, 18);
          },
          shade: 0.12,
          ink: 0.9,
        },
      );
      g.strokeStyle = INK;
      g.lineWidth = 0.7;
      for (const dy of [-13.5, -9, -4.5]) {
        seg(g, x - 9, y + dy, x + 9, y + dy);
        g.stroke();
      }
      seg(g, x - 7, y - 2, x + 7, y - 16);
      g.stroke();
      g.restore();
    }
    // a faded pennant on the king post, lamps behind the portholes
    cloth(g, GX1 + 1, GT - 28, 28, 14, t, 0.8, "#b9735c");
    glowPane(g, s, 0, -208, 11, null, 0.3);
    glowPane(g, s, 0, -122, 10, null, 1.9);
  },
  // the steam and smoke that roll off it: never part of its shape
  ambient(g, s) {
    const t = s.t;
    const c = t % CYC;
    // the engine test: a short burst of steam and smoke rolling out over the pad from both bells
    const q = c - PUFF0;
    if (q > 0 && q < 5.4) {
      for (const k of [-1, 1])
        for (let i = 0; i < 9; i++) {
          const age = (q - i * 0.2) / 3.6;
          if (age <= 0 || age >= 1) continue;
          const e = 1 - (1 - age) ** 2;
          puff(
            g,
            k * (66 + e * (42 + i * 3.2)),
            -6 - e * (7 + (i % 3) * 7) - Math.sin(age * 6 + i) * 2,
            5 + e * (11 + (i % 2) * 4),
            0.34 * (1 - age) * Math.min(1, age * 9),
          );
        }
      const fl = Math.max(0, 1 - q / 1.5) * (0.7 + 0.3 * Math.sin(t * 31));
      if (fl > 0) {
        g.save();
        g.globalCompositeOperation = "lighter";
        for (const x of [-64, 64]) {
          const fg = g.createRadialGradient(x, -2, 1, x, -2, 28);
          fg.addColorStop(0, `rgba(255,190,110,${0.75 * fl})`);
          fg.addColorStop(1, "rgba(255,150,60,0)");
          g.fillStyle = fg;
          g.fillRect(x - 28, -26, 56, 36);
        }
        g.restore();
      }
    }
    // the tank venting through its relief valve, harder in some moments than others
    const ve = Math.max(0, gust(t, 1.3) - 0.2);
    for (let i = 0; i < 6; i++) {
      const k = (t * 0.33 + i / 6) % 1;
      puff(
        g,
        -HW - 9 - k * 36 - Math.sin(k * 4 + i) * 4,
        -168 - k * 34 - k * k * 20,
        3 + k * 11,
        0.55 * ve * (1 - k) * Math.min(1, k * 7),
      );
    }
  },
};
