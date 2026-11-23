// The File Explorer's building on Isle: the filing chest — an oak card-catalogue
// chest of nine drawers, each with its brass label holder and cup pull, on a
// stone plinth, roofed by a manila folder laid over it like a tent, its papers
// showing at the ridge; the door is the middle drawer of the bottom row. It is
// the app at work: one drawer at a time rolls out on its folders and back, a
// folder is hoisted out of one, looked at and put back, and now and then a
// sheet slips out of the roof and tumbles down to the tray on the trolley.

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
  ivy,
  jit,
  light,
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
  BRASS_L,
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
const { parkMiller } = polyKit;

const GRAIN_BOX: Box = [-205, -300, 235, 62];
const OAK = "#8f7450";
const PAPER = "#e4dbc2";
/** The drawer columns (their centres) and rows (the bottom of each bay); a drawer front's size. */
const CX = [-74, 0, 74] as const;
const RY = [-12, -80, -148] as const;
const DW = 66;
const DH = 60;
/** The chest's front half-width, its top, the roof's eave and ridge, and how deep its right side is. */
const FW = 117;
const TOP = -218;
const EAVE = -226;
const RIDGE = -270;
const D = 20;
const ROOF = oblique.gableRoof({
  x0: -FW - 10,
  x1: FW + 10,
  y: EAVE,
  d: D,
  rise: EAVE - RIDGE - oblique.rise(D / 2),
});
/** A drawer bay: `[column, row]`. */
type Bay = readonly [0 | 1 | 2, 0 | 1 | 2];
/** The two drawers that open: the one the hoist works over, and one that only slides. */
const HOIST: Bay = [2, 1];
const SLIDE: Bay = [0, 2];
const PULLEY: Pt = [69, -212];

/** The top-left corner of a bay's drawer front. */
const cell = ([c, row]: Bay): Pt => [CX[c] - DW / 2, RY[row] - DH - 3];
/** The folder's manila: the app's hue, faded into buff card. */
const manila = (s: PaintState): string => mix(accent(s.hue), "#c4ad7a", 0.45);
/** 0 → 1 between `a` and `b`, eased. */
const ss = (a: number, b: number, x: number): number =>
  ease(clamp01((x - a) / (b - a)));

/**
 * One drawer front, (x, y) its top-left: oak boards, a bevelled field, a brass
 * label holder with its card (lamp-lit at night), a cup pull — or, for the bay
 * the door stands in (`door`), only a small label above it.
 */
function drawerFront(
  g: Ctx2D,
  r: Rnd,
  x: number,
  y: number,
  lit: boolean,
  door = false,
): void {
  planks(g, x, y, x + DW, y + DH, r, { base: OAK, vertical: false, pw: 8 });
  g.strokeStyle = "rgba(255,240,210,.22)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x + 4, y + DH - 4);
  g.lineTo(x + 4, y + 4);
  g.lineTo(x + DW - 4, y + 4);
  g.stroke();
  g.strokeStyle = "rgba(30,22,12,.4)";
  g.beginPath();
  g.moveTo(x + DW - 4, y + 4);
  g.lineTo(x + DW - 4, y + DH - 4);
  g.lineTo(x + 4, y + DH - 4);
  g.stroke();
  const cx = x + DW / 2;
  const ly = door ? y + 2 : y + 8;
  const lw = door ? 22 : 30;
  const lh = door ? 10 : 16;
  g.fillStyle = "rgba(30,22,12,.35)";
  g.fillRect(cx - lw / 2, ly + 1.5, lw + 1.5, lh);
  g.fillStyle = BRASS;
  g.fillRect(cx - lw / 2, ly, lw, lh);
  ink(g, 1);
  g.strokeRect(cx - lw / 2, ly, lw, lh);
  const cg = g.createLinearGradient(0, ly, 0, ly + lh);
  if (lit) {
    cg.addColorStop(0, "#ffe2a0");
    cg.addColorStop(1, "#e7a54e");
  } else {
    cg.addColorStop(0, "#ece3ca");
    cg.addColorStop(1, "#cdc2a4");
  }
  g.fillStyle = cg;
  g.fillRect(cx - lw / 2 + 2.4, ly + 2.4, lw - 4.8, lh - 4.8);
  ink(g, 0.7, 0.6);
  g.strokeRect(cx - lw / 2 + 2.4, ly + 2.4, lw - 4.8, lh - 4.8);
  rivet(g, cx - lw / 2 + 0.4, ly + lh / 2 - 0.5, 0.8);
  rivet(g, cx + lw / 2 - 1.6, ly + lh / 2 - 0.5, 0.8);
  if (door) return;
  const py = y + DH - 12;
  g.fillStyle = "rgba(30,22,12,.4)";
  g.beginPath();
  g.ellipse(cx + 1, py + 2.5, 13.5, 3.6, 0, 0, TAU);
  g.fill();
  g.beginPath();
  g.ellipse(cx, py, 13, 9.5, 0, Math.PI, 0);
  g.closePath();
  const pg = g.createLinearGradient(cx - 12, py - 9, cx + 12, py);
  pg.addColorStop(0, BRASS_L);
  pg.addColorStop(0.5, BRASS);
  pg.addColorStop(1, BRASS_D);
  g.fillStyle = pg;
  g.fill();
  ink(g, 1);
  g.stroke();
  g.fillStyle = "rgba(30,22,12,.55)";
  g.fillRect(cx - 10.5, py - 2, 21, 2);
}

/** A manila folder standing on its spine, (x, y) the top-left of its body, a sheet showing above it. */
function folder(
  g: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  col: string,
): void {
  g.fillStyle = PAPER;
  g.fillRect(x + 4, y + 0.5, w - 7, 8);
  g.strokeStyle = INK;
  g.lineWidth = 0.7;
  g.strokeRect(x + 4, y + 0.5, w - 7, 8);
  g.beginPath();
  g.moveTo(x, y + 6);
  g.lineTo(x + 3, y);
  g.lineTo(x + w * 0.4, y);
  g.lineTo(x + w * 0.46, y + 6);
  g.lineTo(x + w, y + 6);
  g.lineTo(x + w, y + h);
  g.lineTo(x, y + h);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.lineWidth = 1.1;
  g.lineJoin = "round";
  g.stroke();
  g.strokeStyle = "rgba(255,244,214,.3)";
  g.lineWidth = 0.8;
  seg(g, x + 1.5, y + 7.5, x + w - 1.5, y + 7.5);
  g.stroke();
  g.fillStyle = "rgba(60,44,20,.16)";
  g.fillRect(x + w * 0.6, y + 6, w * 0.4, h - 6);
}

/**
 * An open drawer, pulled `d` px toward us (out of the picture, along the receding vector):
 * its side and the folders standing in it. Returns where its front now is.
 */
function openDrawer(g: Ctx2D, at: Bay, d: number, M: string): Pt {
  const [x, y] = cell(at);
  // toward us is the receding vector, backwards
  const [ox, oy] = oblique.back([0, 0], -0.82 * d);
  if (d > 0.3) {
    g.fillStyle = "rgba(24,18,10,.3)";
    g.fillRect(x + ox + 2, y + DH + oy, DW, 6);
    poly(g, [
      [x + DW + ox, y + oy],
      [x + DW, y],
      [x + DW, y + DH],
      [x + DW + ox, y + DH + oy],
    ]);
    g.fillStyle = "#5e4a34";
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1;
    g.lineJoin = "round";
    g.stroke();
    poly(g, [
      [x + ox, y + oy],
      [x + DW + ox, y + oy],
      [x + DW, y],
      [x, y],
    ]);
    g.fillStyle = "#2c241b";
    g.fill();
    g.stroke();
    for (let k = 0; k < 5; k++) {
      const u = 0.13 + k * 0.17;
      if (u * d < 1.6) continue;
      const fx = x + ox * u + 2.5;
      const fy = y + oy * u;
      const tx = fx + 4 + ((k * 17) % 36);
      g.fillStyle = k % 2 ? M : dark(M, 0.12);
      g.fillRect(fx, fy - 1.8, DW - 5, 3);
      g.fillRect(tx, fy - 5, 17, 3.6);
      g.strokeStyle = "rgba(48,38,28,.6)";
      g.lineWidth = 0.6;
      g.strokeRect(tx, fy - 5, 17, 3.6);
      seg(g, fx, fy + 1.2, fx + DW - 5, fy + 1.2);
      g.stroke();
    }
  }
  return [x + ox, y + oy];
}

/** A loose sheet of paper, tumbling: its centre, size, spin (its apparent width), tilt and opacity. */
function sheet(
  g: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  spin: number,
  tilt: number,
  a: number,
): void {
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  g.globalAlpha = a;
  const k = 0.25 + 0.75 * Math.abs(Math.cos(spin));
  g.beginPath();
  g.moveTo((-w / 2) * k, -h / 2);
  g.lineTo((w / 2) * k, -h / 2 + 1.5);
  g.lineTo((w / 2) * k, h / 2);
  g.lineTo((-w / 2) * k, h / 2 - 1.5);
  g.closePath();
  g.fillStyle = Math.cos(spin) > 0 ? PAPER : "#cfc5aa";
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 0.9;
  g.lineJoin = "round";
  g.stroke();
  g.restore();
}

export const filingChest: BuildingSpec = {
  door: { kind: "leaf", w: 34, h: 60, arch: true },
  footprint: {
    w: 240,
    depth: 80,
    ground: [-200, -112, 231, 56],
    upper: [-130, -294, 179, -112],
  },
  setting: ["harbour", "shore"],
  signX: -175,
  lights: [
    [0, -32, 20],
    [-74, -128, 11],
    [0, -128, 11],
    [-74, -60, 11],
    [74, -60, 11],
    [0, -196, 11],
    [74, -196, 11],
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const M = manila(s);
    castShadow(
      g,
      [
        [-108, 4],
        [120, 4],
        [192, 28],
        [214, 2],
        [140, -14],
      ],
      0.28,
    );
    // the carcass: side panel, front frame, the dark bays of the two working drawers
    oblique.fill(g, oblique.sideFace(FW, 0, TOP, D), (side) =>
      wash(g, () => poly(g, side), bbox(side), dark(OAK, 0.38), r, {
        blob: 5,
        var: 16,
        shadeA: 0.3,
        lw: 1.4,
      }),
    );
    // its rails and boards, drawn flat and sheared onto the side
    oblique.onSide(g, FW, () => {
      ink(g, 0.7, 0.5);
      for (const y of RY) hline(g, 1, y - 1, D - 1, y - 1, r, 0.3);
      for (const k of [0.3, 0.55, 0.8])
        hline(g, D * k, -3, D * k, TOP + 1, r, 0.5);
    });
    planks(g, -FW, TOP, FW, -10, r, { base: "#6b563c", pw: 9 });
    g.save();
    g.beginPath();
    g.rect(-FW, TOP, 2 * FW, -10 - TOP);
    g.clip();
    streaks(g, r, [-FW, TOP, FW, -10], 16, "36,28,18", 0.16, 80);
    g.restore();
    for (const row of [0, 1, 2] as const)
      for (const c of [0, 1, 2] as const) {
        const [x, y] = cell([c, row]);
        g.fillStyle = "#231c15";
        g.fillRect(x - 1.5, y - 1.5, DW + 3, DH + 3);
        if (
          (c === HOIST[0] && row === HOIST[1]) ||
          (c === SLIDE[0] && row === SLIDE[1])
        ) {
          if (lit) {
            g.fillStyle = "rgba(255,190,100,.2)";
            g.fillRect(x, y, DW, DH);
          }
          continue;
        }
        drawerFront(g, r, x, y, lit, c === 1 && row === 0);
      }
    // a stone plinth, the door in the middle bay
    stones(g, -FW - 3, -12, FW + 3, 0, r, {
      rowH: 6,
      blockW: 16,
      base: "#a59d8b",
    });
    oblique.fill(g, oblique.sideFace(FW + 3, 0, -12, D), (sp) =>
      wash(g, () => poly(g, sp), bbox(sp), "#7d7667", r, {
        blob: 3,
        var: 14,
        lw: 1.1,
      }),
    );
    doorArch(g, 0, 0, 34, 60, r, { col: dark(M, 0.12), surround: false });
    steps(g, 0, 2, 38, 1, r);
    // the cornice, and the shade under it
    g.fillStyle = "rgba(30,22,12,.3)";
    g.fillRect(-FW, TOP, 2 * FW, 7);
    oblique.fill(g, oblique.sideFace(FW + 4, TOP, TOP - 7, D), (cs) =>
      wash(g, () => poly(g, cs), bbox(cs), "#5a4832", r, {
        blob: 3,
        var: 12,
        lw: 1.1,
      }),
    );
    planks(g, -FW - 4, TOP - 7, FW + 4, TOP, r, {
      base: "#7d6648",
      vertical: false,
      pw: 3.5,
    });
    // the roof: a manila folder laid over the chest like a tent — its tab and the papers in it at the ridge, the page block at the gable, its front leaf
    const RX = ROOF.ridge[0][0] + FW + 10;
    const tab: Pt[] = [
      [-96, RIDGE],
      [-90, RIDGE - 16],
      [-36, RIDGE - 16],
      [-30, RIDGE],
    ];
    const back: Pt[] = [
      [-FW - 10 + RX, RIDGE],
      [FW + 10 + RX, RIDGE],
      [FW + 10 + RX, RIDGE - 5],
      [-FW - 10 + RX, RIDGE - 5],
    ];
    for (const p of [tab, back])
      wash(g, () => poly(g, p), bbox(p), dark(M, 0.18), r, {
        blob: 4,
        var: 16,
        shadeA: 0.2,
        lw: 1.3,
      });
    g.fillStyle = dark(M, 0.18);
    g.fillRect(-95, RIDGE - 6.5, 64, 3);
    for (const [x, y, w, a] of [
      [22, RIDGE - 10, 44, 0.03],
      [60, RIDGE - 8, 52, -0.02],
      [-18, RIDGE - 6, 56, 0.01],
    ] as const) {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.fillStyle = jit(PAPER, r, 10);
      g.fillRect(0, 0, w, 14);
      ink(g, 0.8, 0.7);
      g.strokeRect(0, 0, w, 14);
      g.restore();
    }
    const gab = ROOF.gable;
    oblique.fill(g, gab, () => {
      g.save();
      poly(g, gab);
      g.fillStyle = "#cfc5aa";
      g.fill();
      g.clip();
      for (let k = 1; k < 12; k++) {
        g.strokeStyle = `rgba(86,70,44,${0.25 + r() * 0.3})`;
        g.lineWidth = 0.6;
        seg(g, FW + 10 + k * 1.8, EAVE + 2, FW + 10 + RX, RIDGE + k * 3.4);
        g.stroke();
      }
      g.fillStyle = "rgba(40,30,16,.2)";
      g.fillRect(FW, RIDGE, 40, 50);
      g.restore();
      poly(g, gab);
      ink(g, 1.3);
      g.stroke();
    });
    const leaf = ROOF.slope;
    wash(g, () => poly(g, leaf), bbox(leaf), M, r, {
      blob: 8,
      var: 20,
      shadeA: 0.24,
      lw: 1.5,
    });
    g.save();
    poly(g, leaf);
    g.clip();
    ink(g, 0.6, 0.3);
    for (let x = -FW - 2; x < FW + 10; x += 15)
      hline(g, x, EAVE, x + RX, RIDGE, r, 0.6);
    streaks(g, r, [-FW - 10, RIDGE, FW + 20, EAVE], 18, "70,54,26", 0.16, 30);
    for (let k = 0; k < 12; k++) {
      g.fillStyle = "rgba(96,112,58,.28)";
      g.beginPath();
      g.ellipse(
        -FW - 6 + r() * 2 * FW,
        EAVE - 5 + r() * 5,
        4 + r() * 6,
        1.5 + r() * 2,
        0,
        0,
        TAU,
      );
      g.fill();
    }
    g.fillStyle = "rgba(255,244,214,.14)";
    g.fillRect(-FW - 10, RIDGE, 2 * FW + 40, 6);
    g.restore();
    seg(g, -FW - 10, EAVE, FW + 10, EAVE);
    bar(g, 2.6, dark(M, 0.3), "rgba(255,244,214,.25)");
    // the hoist bracket under the eave
    seg(g, PULLEY[0] - 10, EAVE + 3, PULLEY[0], PULLEY[1] - 1);
    bar(g, 2, IRON, null);
    seg(g, PULLEY[0] + 10, EAVE + 3, PULLEY[0], PULLEY[1] - 1);
    bar(g, 2, IRON, null);
    disc(g, PULLEY[0], PULLEY[1], 4);
    g.fillStyle = BRASS_D;
    g.fill();
    ink(g, 1);
    g.stroke();
    // out front: a flat trolley with archive boxes and a paper tray, crates, a barrel
    g.save();
    g.translate(138, 30);
    castShadow(
      g,
      [
        [0, 12],
        [74, 12],
        [84, 17],
        [10, 17],
      ],
      0.26,
    );
    for (const x of [10, 64]) {
      disc(g, x, 10, 5.5);
      g.fillStyle = "#4a443c";
      g.fill();
      ink(g, 1);
      g.stroke();
      disc(g, x, 10, 1.7);
      g.fillStyle = BRASS;
      g.fill();
    }
    // the trolley's bed, seen from above, then its near edge
    oblique.onTop(g, -1, () => {
      g.fillStyle = "#7b6549";
      g.fillRect(0, 0, 74, 8);
      ink(g, 0.9, 0.7);
      g.strokeRect(0, 0, 74, 8);
    });
    planks(g, 0, -1, 74, 5, r, { base: "#8a7253", vertical: false, pw: 6 });
    seg(g, 74, 1, 84, -34);
    bar(g, 2.4, IRON, null);
    seg(g, 79, -34, 90, -34);
    bar(g, 2.6, IRON, null);
    for (const [x, y, w, h, c] of [
      [2, -1, 27, 20, "#8e7a58"],
      [5, -21, 22, 15, dark(M, 0.1)],
    ] as const) {
      // an archive box: its lid seen from above, its end receding
      oblique.solid(
        g,
        { x0: x, x1: x + w, yb: y, yt: y - h, d: 7 },
        {
          side: (d, yt, yb) => {
            g.fillStyle = dark(c, 0.3);
            g.fillRect(0, yt, d, yb - yt);
          },
          top: (x0, x1, d) => {
            g.fillStyle = light(c, 0.14);
            g.fillRect(x0, 0, x1 - x0, d);
          },
          front: () => {
            g.fillStyle = c;
            g.fillRect(x, y - h, w, h);
          },
          shade: 0,
          ink: 1,
        },
      );
      g.fillStyle = "rgba(30,22,12,.3)";
      g.fillRect(x, y - h + 4, w, 1.2);
      g.fillStyle = PAPER;
      g.fillRect(x + w / 2 - 5, y - h + 7, 10, 5);
    }
    g.fillStyle = BRASS_D;
    g.fillRect(34, -4.5, 36, 3.5);
    ink(g, 0.9);
    g.strokeRect(34, -4.5, 36, 3.5);
    for (let k = 0; k < 6; k++) {
      g.fillStyle = jit(PAPER, r, 12);
      g.fillRect(36 + (r() - 0.5) * 2, -6.5 - k * 1.7, 32, 1.9);
      ink(g, 0.5, 0.5);
      g.strokeRect(36, -6.5 - k * 1.7, 32, 1.9);
    }
    g.restore();
    crate(g, -166, 18, 20, r);
    crate(g, -158, -2, 16, r);
    barrel(g, 176, -8, 9, r);
    ivy(g, -FW + 3, -4, -150, r, 18);
    moss(g, -FW - 3, FW + 3, 1, r, 20);
    tufts(g, -FW - 10, FW + 14, 3, r, 30);
    for (const [x, y, z, k] of [
      [-184, 36, 12, 1],
      [204, 12, 11, 0],
      [-70, 40, 9, 2],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    const c = t % 26;
    const M = manila(s);
    const lit = s.night;
    // the drawer fronts are repainted every frame: a fixed stream, so they never shimmer
    const r = parkMiller(77);
    // one drawer at a time rolls out and back; a folder is hoisted out of the first, looked at, and put back
    const dA = 24 * (ss(0, 3, c) - ss(14, 17, c));
    const dB = 24 * (ss(18, 20.5, c) - ss(23, 25.5, c));
    const hook =
      -158 +
      26 * ss(3, 3.6, c) -
      46 * ss(3.9, 7, c) +
      46 * ss(10, 13.2, c) -
      26 * ss(13.4, 14, c);
    const has = c > 3.6 && c < 13.4;
    const [bx, by] = openDrawer(g, SLIDE, dB, M);
    drawerFront(g, r, bx, by, lit);
    const [ax, ay] = openDrawer(g, HOIST, dA, M);
    const sway = has
      ? Math.sin(t * 1.1) * 1.6 * ss(4, 7, c) * (1 - ss(10, 13, c))
      : 0;
    const hx = PULLEY[0] - 5 + sway;
    g.strokeStyle = "rgba(60,48,34,.9)";
    g.lineWidth = 1.1;
    seg(g, PULLEY[0], PULLEY[1], hx + 5, hook - 4);
    g.stroke();
    if (has) {
      g.save();
      g.beginPath();
      g.rect(-300, -500, 600, 500 + ay);
      g.clip();
      folder(g, hx - 17, hook, 44, 36, M);
      g.restore();
    }
    g.strokeStyle = IRON;
    g.lineWidth = 1.8;
    g.lineCap = "round";
    g.beginPath();
    g.arc(hx + 5, hook - 1.5, 3, -1.2, 3.4);
    g.stroke();
    drawerFront(g, r, ax, ay, lit);
    // a loose leaf of the roof folder lifting at the gable
    const lf =
      (0.15 + Math.max(0, gust(t, 2.2))) * (0.7 + 0.3 * Math.sin(t * 2.3));
    g.beginPath();
    g.moveTo(98, RIDGE - 1);
    g.lineTo(136, RIDGE - 1);
    g.quadraticCurveTo(
      143 + lf * 2,
      RIDGE - 5 - lf * 5,
      148 + lf * 4,
      RIDGE - 4 - lf * 14,
    );
    g.lineTo(110, RIDGE - 9 - lf * 4);
    g.closePath();
    g.fillStyle = PAPER;
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1;
    g.lineJoin = "round";
    g.stroke();
    // lamps behind the label cards
    glowPane(g, s, -12.6, -200.6, 25.2, 11.2, 0.4);
    glowPane(g, s, 61.4, -64.6, 25.2, 11.2, 2.1);
  },
  // the sheet in the air: loose of the chest, never part of its shape
  ambient(g, s) {
    const t = s.t;
    // now and then a sheet slips out of the roof folder and tumbles down to the tray on the trolley
    const k = ((t + 7) % 21) / 8;
    if (k < 1)
      sheet(
        g,
        140 + 50 * k + Math.sin(k * 11) * 12 * (1 - k),
        RIDGE - 4 + (22 - RIDGE) * Math.pow(k, 1.25),
        16,
        12,
        t * 2.4,
        Math.sin(k * 11 + 1) * 0.7,
        Math.min(1, k * 8, (1 - k) * 6),
      );
  },
};
