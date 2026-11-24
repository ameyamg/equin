// Desktop's building on Isle: the window gallery — windows over a wallpaper,
// built. A long hall under a glasshouse roof whose whole upper storey is a
// painted backdrop on rollers (the wallpaper), a stair tower at its end under
// a slate spire, and in front of both, hung on iron tracks, three glazed
// screens boxed out like oriels — each a framed window with a painted head
// rail and three brass studs — overlapping one another and the tower's
// corner; along the foot, either side of the door, runs the shelf, with the
// things kept to hand standing on it. It is the desktop at work: the front
// screen rolls along its track from over its neighbour to over the tower's
// corner and back; the backdrop winds on to another scene (morning hills, the
// sea at dusk, a wood by night); the blind of the tower's screen is let down
// and drawn up again; the shelf's lamp burns from dusk.

import {
  accent,
  bbox,
  castShadow,
  grain,
  moss,
  oblique,
  shingles,
  tufts,
  windowRect,
  dark,
  doorArch,
  fittings,
  hline,
  ink,
  ivy,
  light,
  mix,
  poly,
  polyKit,
  shrub,
  steps,
  stones,
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
  IRON,
  BRASS,
  BRASS_D,
  clamp01,
  ease,
  disc,
  seg,
  bar,
  rivet,
  streaks,
} = fittings;

const GRAIN_BOX: Box = [-140, -300, 200, 40];

/** The front: the hall on the left, the tower on the right, in one plane. */
const L = -118;
const R = 118;
const W = R - L;
const HALL_H = 170;
const TOWER_L = 40;
const TOWER_H = 226;
/** How deep the tower's side shows. */
const SD = 24;
/** The spire: a hipped cap over the tower. */
const SPIRE = oblique.hipRoof({
  x0: TOWER_L - 7,
  x1: R + 7,
  y: 3 - TOWER_H,
  d: SD,
  rise: 54.6,
});
const TIP: Pt = SPIRE.apex;
/** The top of the stone ground storey. */
const BASE = -70;
/** The backdrop's opening: x, y, w, h. */
const DROP = [-108, -160, 138, 76] as const;
/** The tracks the screens hang from: the hall's, and the tower's own. */
const TRACK = -165;
const TOWER_TRACK = -212;
/** The shelf's top, and its two runs either side of the door. */
const SHELF = -30;
const RUNS = [
  [-110, -27],
  [27, 110],
] as const;

/** The back screens (x, y, w, h), and the front one with the two places it rests at. */
// (the big one hangs out past the hall's corner on the track's outboard end; one stands over the roof on its own gantry)
const BIG = [-150, -153, 66, 60] as const;
const SMALL = [54, -204, 50, 42] as const;
const FRONT = { y: -131, w: 64, h: 50, from: -92, to: 6 } as const;
/** How far the hall's track runs out past the wall, and the roof screen (x, y, w, h) with its gantry's rail. */
const OUTBOARD = 42;
const ROOF_SCREEN = [-82, -252, 52, 40] as const;
const ROOF_TRACK = -262;
/** The walls a hanging screen's shadow can fall on: the whole front below the eave, the tower's. */
const HALL_WALL: Box = [L, -HALL_H, R, 0];
const TOWER_WALL: Box = [TOWER_L, -TOWER_H, R, 0];

/** A value in 0..1 from an integer, the same every time: the backdrops' stars and trees. */
const hash = (n: number): number => {
  const v = Math.sin(n * 127.1 + 31.7) * 43758.5453;
  return v - Math.floor(v);
};

/** One painted scene of the backdrop, filling (x, y, w, h); the caller clips. */
function scene(
  g: Ctx2D,
  k: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const sky = g.createLinearGradient(0, y, 0, y + h);
  const ridge = (
    base: number,
    amp: number,
    f: number,
    ph: number,
    col: string,
  ) => {
    g.beginPath();
    g.moveTo(x, y + h);
    for (let px = 0; px <= w; px += 4)
      g.lineTo(
        x + px,
        y +
          h * base -
          amp *
            (Math.sin(px * f + ph) + 0.45 * Math.sin(px * f * 2.3 + ph * 2)),
      );
    g.lineTo(x + w, y + h);
    g.closePath();
    g.fillStyle = col;
    g.fill();
    g.strokeStyle = "rgba(48,38,28,.35)";
    g.lineWidth = 0.8;
    g.stroke();
  };
  if (k === 0) {
    // morning hills
    sky.addColorStop(0, "#b9c2b4");
    sky.addColorStop(1, "#dccfa8");
    g.fillStyle = sky;
    g.fillRect(x, y, w, h);
    disc(g, x + w * 0.73, y + h * 0.3, 11);
    g.fillStyle = "#e6d29a";
    g.fill();
    ridge(0.6, 9, 0.021, 0.4, "#97a58e");
    ridge(0.78, 7, 0.034, 2.2, "#7c9070");
    ridge(0.95, 5, 0.05, 4, "#657a58");
    for (let i = 0; i < 6; i++) {
      const tx = x + 16 + hash(i) * (w - 32);
      const ty = y + h * (0.8 + 0.1 * hash(i + 9));
      g.fillStyle = "#4f6248";
      g.beginPath();
      g.ellipse(tx, ty - 7, 2.6, 8, 0, 0, TAU);
      g.fill();
    }
  } else if (k === 1) {
    // the sea at dusk
    sky.addColorStop(0, "#a9a39a");
    sky.addColorStop(0.55, "#dcb58a");
    g.fillStyle = sky;
    g.fillRect(x, y, w, h);
    disc(g, x + w * 0.3, y + h * 0.56, 12);
    g.fillStyle = "#dc9a6c";
    g.fill();
    g.fillStyle = "#62808a";
    g.fillRect(x, y + h * 0.58, w, h * 0.42);
    g.strokeStyle = "rgba(232,222,196,.5)";
    g.lineWidth = 1;
    for (let i = 0; i < 16; i++) {
      const wx = x + hash(i + 20) * w;
      const wy = y + h * (0.63 + 0.34 * hash(i + 40));
      seg(g, wx - 6 - 6 * hash(i), wy, wx + 6, wy);
      g.stroke();
    }
    const bx = x + w * 0.68;
    const by = y + h * 0.66;
    g.fillStyle = "#e8dfc6";
    poly(g, [
      [bx, by - 22],
      [bx + 11, by - 3],
      [bx, by - 3],
    ]);
    g.fill();
    poly(g, [
      [bx - 2, by - 17],
      [bx - 2, by - 3],
      [bx - 9, by - 3],
    ]);
    g.fill();
    g.fillStyle = "#4a3f36";
    poly(g, [
      [bx - 12, by - 2],
      [bx + 13, by - 2],
      [bx + 9, by + 3],
      [bx - 8, by + 3],
    ]);
    g.fill();
  } else {
    // a wood by night
    sky.addColorStop(0, "#39485a");
    sky.addColorStop(1, "#66747a");
    g.fillStyle = sky;
    g.fillRect(x, y, w, h);
    disc(g, x + w * 0.24, y + h * 0.26, 9);
    g.fillStyle = "#e6dfc4";
    g.fill();
    g.fillStyle = "rgba(240,232,206,.8)";
    for (let i = 0; i < 26; i++)
      g.fillRect(x + hash(i + 60) * w, y + hash(i + 90) * h * 0.55, 1.2, 1.2);
    ridge(0.8, 6, 0.03, 1, "#4a5a56");
    for (let i = 0; i < 15; i++) {
      const tx = x + (i + 0.5) * (w / 15) + (hash(i + 3) - 0.5) * 8;
      const th = 22 + hash(i + 70) * 22;
      g.fillStyle = i % 2 ? "#2c3a36" : "#35443e";
      poly(g, [
        [tx - 7, y + h],
        [tx, y + h - th],
        [tx + 7, y + h],
      ]);
      g.fill();
    }
  }
  // the canvas's age: seams, and a fold down the middle
  g.strokeStyle = "rgba(48,38,28,.16)";
  g.lineWidth = 0.8;
  for (const sx of [0.25, 0.5, 0.75]) {
    seg(g, x + w * sx, y, x + w * sx, y + h);
    g.stroke();
  }
}

/**
 * One glazed screen on the track: hangers and wheels, its shadow on what is
 * behind, leaded glass (lamp-lit when `lit`), a blind let down by `blind`
 * (0..1), an oak frame under a painted head rail with three brass studs.
 */
function screen(
  g: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  paint: string,
  lit: boolean,
  blind: number,
  track: number,
  q: number,
  wall: Box | null,
): void {
  // boxed out from the wall, `q` deep (the further it floats off the wall, the further its shadow falls): its shadow — only on the `wall` behind it, never on the air past the wall's edge (none: it hangs in the open) —, its top and its right cheek
  if (wall) {
    g.save();
    g.beginPath();
    g.rect(wall[0], wall[1], wall[2] - wall[0], wall[3] - wall[1]);
    g.clip();
    g.fillStyle = "rgba(20,16,10,.3)";
    g.fillRect(x + q - 1, y + q + 1, w + 2, h);
    g.restore();
  }
  const cheek = oblique.sideFace(x + w, y + h, y, q);
  oblique.fill(g, cheek, (pts) => {
    g.fillStyle = "#4d3e2e";
    poly(g, pts);
    g.fill();
  });
  oblique.inkFace(g, cheek, 1.1);
  const lid = oblique.topFace(x, x + w, y, q);
  oblique.fill(g, lid, (pts) => {
    g.fillStyle = "#8a7558";
    poly(g, pts);
    g.fill();
  });
  oblique.inkFace(g, lid, 1.1);
  for (const hx of [x + 11, x + w - 11]) {
    g.strokeStyle = IRON;
    g.lineWidth = 2.2;
    seg(g, hx, track, hx, y - 2);
    g.stroke();
    disc(g, hx, track, 3);
    g.fillStyle = IRON;
    g.fill();
    g.fillStyle = "rgba(255,244,214,.4)";
    g.fillRect(hx - 1.2, track - 1.2, 1.4, 1.4);
  }
  const gx = x + 4;
  const gy = y + 12;
  const gw = w - 8;
  const gh = h - 16;
  const gl = g.createLinearGradient(gx, gy, gx + gw, gy + gh);
  if (lit) {
    gl.addColorStop(0, "#ffe2a0");
    gl.addColorStop(1, "#e2a04e");
  } else {
    gl.addColorStop(0, "#8f9c9e");
    gl.addColorStop(0.5, "#56636a");
    gl.addColorStop(1, "#39434a");
  }
  g.fillStyle = gl;
  g.fillRect(gx, gy, gw, gh);
  if (!lit) {
    g.save();
    g.beginPath();
    g.rect(gx, gy, gw, gh);
    g.clip();
    g.strokeStyle = "rgba(226,236,236,.26)";
    g.lineWidth = 5;
    seg(g, gx + gw * 0.08, gy + gh, gx + gw * 0.5, gy);
    g.stroke();
    g.lineWidth = 2;
    seg(g, gx + gw * 0.3, gy + gh, gx + gw * 0.72, gy);
    g.stroke();
    g.restore();
  }
  // the leads
  g.strokeStyle = "#43382c";
  g.lineWidth = 1.2;
  const cols = Math.round(gw / 22);
  g.beginPath();
  for (let c = 1; c < cols; c++) {
    g.moveTo(gx + (gw * c) / cols, gy);
    g.lineTo(gx + (gw * c) / cols, gy + gh);
  }
  g.moveTo(gx, gy + gh * 0.5);
  g.lineTo(gx + gw, gy + gh * 0.5);
  g.stroke();
  if (blind > 0.01) {
    const bh = gh * blind;
    g.fillStyle = "#cfc4a4";
    g.fillRect(gx, gy, gw, bh);
    g.strokeStyle = "rgba(90,74,46,.3)";
    g.lineWidth = 0.7;
    for (let by = gy + 5; by < gy + bh - 2; by += 5) {
      seg(g, gx, by, gx + gw, by);
      g.stroke();
    }
    g.fillStyle = "#6b563f";
    g.fillRect(gx, gy + bh - 2.4, gw, 2.4);
    g.strokeStyle = INK;
    g.lineWidth = 0.8;
    seg(g, gx + gw / 2, gy + bh, gx + gw / 2, gy + bh + 5);
    g.stroke();
    disc(g, gx + gw / 2, gy + bh + 6, 1.5);
    g.fillStyle = BRASS;
    g.fill();
  }
  // the frame
  g.fillStyle = "#6f5a42";
  g.fillRect(x, y + 10, 4, h - 10);
  g.fillRect(x + w - 4, y + 10, 4, h - 10);
  g.fillRect(x, y + h - 4, w, 4);
  g.fillStyle = "rgba(30,22,14,.3)";
  g.fillRect(x + w - 4, y + 10, 4, h - 10);
  g.fillRect(x, y + h - 1.6, w, 1.6);
  g.fillStyle = paint;
  g.fillRect(x, y, w, 12);
  g.fillStyle = "rgba(255,246,220,.2)";
  g.fillRect(x, y, w, 2);
  g.fillStyle = "rgba(30,22,14,.22)";
  g.fillRect(x, y + 9.5, w, 2.5);
  // worn paint
  g.fillStyle = "rgba(60,48,34,.28)";
  for (let i = 0; i < 4; i++)
    g.fillRect(
      x + 26 + hash(w + i) * (w - 34),
      y + 2 + hash(i) * 6,
      5 + hash(i + 5) * 9,
      1.6,
    );
  for (const k of [0, 1, 2]) {
    disc(g, x + 7 + k * 6.5, y + 6, 2);
    g.fillStyle = k ? BRASS_D : BRASS;
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 0.7;
    g.stroke();
  }
  g.strokeStyle = INK;
  g.lineJoin = "round";
  g.lineWidth = 0.9;
  g.strokeRect(gx, gy, gw, gh);
  g.lineWidth = 1.4;
  g.strokeRect(x, y, w, h);
}

/** The things kept to hand on the shelf, each standing at (x, SHELF). */
function kept(g: Ctx2D, r: Rnd, kind: number, x: number, col: string): void {
  const y = SHELF;
  g.lineJoin = "round";
  if (kind === 0) {
    // a glazed jar
    g.beginPath();
    g.moveTo(x - 4, y);
    g.quadraticCurveTo(x - 9, y - 9, x - 4, y - 16);
    g.lineTo(x - 3, y - 20);
    g.lineTo(x + 3, y - 20);
    g.lineTo(x + 4, y - 16);
    g.quadraticCurveTo(x + 9, y - 9, x + 4, y);
    g.closePath();
  } else if (kind === 1) {
    // a tall bottle
    g.beginPath();
    g.moveTo(x - 4, y);
    g.lineTo(x - 4, y - 14);
    g.lineTo(x - 1.6, y - 19);
    g.lineTo(x - 1.6, y - 25);
    g.lineTo(x + 1.6, y - 25);
    g.lineTo(x + 1.6, y - 19);
    g.lineTo(x + 4, y - 14);
    g.lineTo(x + 4, y);
    g.closePath();
  } else if (kind === 2) {
    // a bowl
    g.beginPath();
    g.moveTo(x - 9, y - 9);
    g.quadraticCurveTo(x - 8, y, x - 3, y);
    g.lineTo(x + 3, y);
    g.quadraticCurveTo(x + 8, y, x + 9, y - 9);
    g.closePath();
  } else if (kind === 3) {
    // a box with a lid
    g.beginPath();
    g.rect(x - 8, y - 12, 16, 12);
  } else {
    // a potted plant
    g.fillStyle = "#56683c";
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      g.ellipse(
        x + (r() - 0.5) * 12,
        y - 14 - r() * 10,
        3.4,
        2.2,
        r() * 3,
        0,
        TAU,
      );
      g.fill();
    }
    g.beginPath();
    g.moveTo(x - 6, y - 11);
    g.lineTo(x + 6, y - 11);
    g.lineTo(x + 4.5, y);
    g.lineTo(x - 4.5, y);
    g.closePath();
  }
  const gr = g.createLinearGradient(x - 9, 0, x + 9, 0);
  gr.addColorStop(0, light(col, 0.2));
  gr.addColorStop(0.45, col);
  gr.addColorStop(1, dark(col, 0.4));
  g.fillStyle = gr;
  g.fill();
  ink(g, 1);
  g.stroke();
  if (kind === 3) {
    ink(g, 0.8, 0.7);
    hline(g, x - 8, y - 8.5, x + 8, y - 8.5, r, 0.3);
    rivet(g, x - 0.6, y - 7.4, 1.2);
  }
}

/** Where the front screen stands at `t`: rests over one neighbour, rolls along, rests over the other, rolls back. */
function frontX(t: number): number {
  const c = t % 21;
  const u =
    c < 6.5
      ? 0
      : c < 10
        ? (c - 6.5) / 3.5
        : c < 17.5
          ? 1
          : 1 - (c - 17.5) / 3.5;
  return FRONT.from + (FRONT.to - FRONT.from) * ease(clamp01(u));
}

/** How far the small screen's blind is let down at `t`. */
function blindAt(t: number): number {
  const c = (t + 9) % 27;
  const u =
    c < 12 ? 0 : c < 14.5 ? (c - 12) / 2.5 : c < 22 ? 1 : 1 - (c - 22) / 2.5;
  return 0.82 * ease(clamp01(u));
}

const headPaint = (s: PaintState): string => mix(accent(s.hue), "#6e5a44", 0.3);

export const windowGallery: BuildingSpec = {
  door: { kind: "leaf", w: 34, h: 58, head: 17 },
  footprint: {
    w: W,
    depth: 74,
    ground: [-153, -112, 191, 28],
    upper: [-164, -302, 153, -112],
  },
  setting: ["square", "lane"],
  signX: -150,
  lights: [
    [-117, -123, 22],
    [-56, -232, 14],
    [79, -180, 16],
    [8, -104, 20],
    [94, -112, 13],
    [0, -30, 16],
    [94, -40, 12],
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const PLASTER = "#cbc0a4";
    const OAK = "#6b563f";
    castShadow(
      g,
      [
        [L + 8, 4],
        [R + 6, 4],
        [R + 56, 16],
        [R + 64, -24],
        [R + SD + 4, -oblique.rise(SD) - 4],
      ],
      0.3,
    );
    // the tower's side: its courses and windows run back along the view vector, in shade
    const side = oblique.sideFace(R, 0, -TOWER_H, SD);
    oblique.onSide(g, R, () => {
      wash(
        g,
        () => {
          g.beginPath();
          g.rect(0, -TOWER_H, SD, TOWER_H);
        },
        [0, -TOWER_H, SD, 0],
        PLASTER,
        r,
        { blob: 9, var: 18, outline: false },
      );
      stones(g, 0, BASE, SD, 0, r, { rowH: 9, outline: false });
      for (const up of [104, 182])
        windowRect(g, 6, -up, 12, 30, r, {
          lit,
          frame: "#4a3a2c",
          sill: "#b3ab98",
        });
    });
    oblique.shadeFace(g, side, 0.34);
    oblique.fill(g, side, (pts) => polyKit.hatch(g, pts, r, 3.5, 0.16));
    oblique.inkFace(g, side, 1.3);
    // the spire: the face that recedes, then the front one
    oblique.fill(g, SPIRE.side, (pts) =>
      shingles(g, pts, r, { base: "#55585d", rowH: 6.5, w: 9 }),
    );
    oblique.fill(g, SPIRE.front, (pts) =>
      shingles(g, pts, r, { base: "#6b6e73", rowH: 6.5, w: 9 }),
    );
    seg(g, TIP[0], TIP[1] + 3, TIP[0], TIP[1] - 9);
    bar(g, 1.6, IRON, null);
    disc(g, TIP[0], TIP[1] - 10, 2.6);
    g.fillStyle = BRASS;
    g.fill();
    ink(g, 0.9);
    g.stroke();
    // the hall's glasshouse roof: panes in iron bars, a crested ridge
    // (a gable along the front, as deep as the tower: its ridge stands half that depth back; the tower cuts it off)
    const GR = oblique.gableRoof({
      x0: L - 8,
      x1: TOWER_L,
      y: 4 - HALL_H,
      d: SD,
      rise: 40 - oblique.rise(SD / 2),
    });
    const lean = GR.ridge[0][0] - (L - 8);
    const glass: Pt[] = [
      [L - 8, 4 - HALL_H],
      [TOWER_L, 4 - HALL_H],
      [TOWER_L, -36 - HALL_H],
      GR.ridge[0],
    ];
    g.save();
    poly(g, glass);
    const gl = g.createLinearGradient(L, -36 - HALL_H, TOWER_L, 4 - HALL_H);
    if (lit) {
      gl.addColorStop(0, "#e9c078");
      gl.addColorStop(1, "#b98a52");
    } else {
      gl.addColorStop(0, "#a9b8b6");
      gl.addColorStop(0.5, "#7d9092");
      gl.addColorStop(1, "#56676c");
    }
    g.fillStyle = gl;
    g.fill();
    g.clip();
    if (!lit) {
      g.fillStyle = "rgba(232,240,236,.22)";
      for (const [x, w] of [
        [-96, 22],
        [-40, 10],
        [4, 16],
      ] as const) {
        poly(g, [
          [x, 4 - HALL_H],
          [x + w, 4 - HALL_H],
          [x + w + lean, -36 - HALL_H],
          [x + lean, -36 - HALL_H],
        ]);
        g.fill();
      }
    }
    for (let k = 0; k < 14; k++) {
      g.fillStyle = "rgba(60,74,52,.2)";
      g.beginPath();
      g.ellipse(
        L + r() * (TOWER_L - L),
        4 - HALL_H - r() * 12,
        5 + r() * 8,
        2 + r() * 3,
        0,
        0,
        TAU,
      );
      g.fill();
    }
    g.strokeStyle = "#3d3a35";
    g.lineWidth = 1.5;
    for (let x = L - 8; x < TOWER_L; x += 13) {
      seg(g, x, 4 - HALL_H, x + lean, -36 - HALL_H);
      g.stroke();
    }
    g.lineWidth = 1.1;
    seg(g, L, -16 - HALL_H, TOWER_L, -16 - HALL_H);
    g.stroke();
    g.restore();
    poly(g, glass);
    ink(g, 1.4);
    g.stroke();
    seg(g, L - 8 + lean, -36 - HALL_H, TOWER_L, -36 - HALL_H);
    bar(g, 2.6, IRON, "rgba(230,236,240,.25)");
    for (let x = L - 2 + lean; x < TOWER_L - 4; x += 13) {
      seg(g, x, -37 - HALL_H, x, -43 - HALL_H);
      bar(g, 1.2, IRON, null);
    }
    // the front: lime plaster, the tower standing up out of the hall
    const front: Pt[] = [
      [L, 0],
      [R, 0],
      [R, -TOWER_H],
      [TOWER_L, -TOWER_H],
      [TOWER_L, -HALL_H],
      [L, -HALL_H],
    ];
    wash(g, () => poly(g, front), bbox(front), PLASTER, r, {
      blob: 10,
      var: 18,
      shadeA: 0.18,
      lw: 1.4,
    });
    g.save();
    poly(g, front);
    g.clip();
    streaks(g, r, [L, -TOWER_H, R, BASE], 16, "96,84,62", 0.11, 60);
    g.fillStyle = "rgba(30,24,16,.24)";
    g.fillRect(L, -HALL_H, TOWER_L - L, 8);
    g.fillRect(TOWER_L, -TOWER_H, R - TOWER_L, 8);
    g.restore();
    ink(g, 1, 0.6);
    hline(g, TOWER_L, -HALL_H, TOWER_L, BASE, r, 0.4);
    // the eaves: the hall's gutter, the tower's cornice
    seg(g, L - 8, 4 - HALL_H, TOWER_L, 4 - HALL_H);
    bar(g, 3, "#55585d", "rgba(230,236,240,.2)");
    wash(
      g,
      () => {
        g.beginPath();
        g.rect(TOWER_L - 5, -TOWER_H - 1, R - TOWER_L + 10, 6);
      },
      [TOWER_L - 5, -TOWER_H - 1, R + 5, 5 - TOWER_H],
      "#a9a290",
      r,
      { blob: 4, shadeA: 0.2, lw: 1.2 },
    );
    // the ground storey: coursed stone, a string course over it
    stones(g, L, BASE, R, 0, r, { rowH: 9 });
    g.save();
    g.beginPath();
    g.rect(L, BASE, W, -BASE);
    g.clip();
    streaks(g, r, [L, BASE, R, 0], 9, "60,54,44", 0.12, 44);
    g.restore();
    polyKit.ao(g, L, R, 0);
    wash(
      g,
      () => {
        g.beginPath();
        g.rect(L - 3, BASE - 5, W + 6, 7);
      },
      [L - 3, BASE - 5, R + 3, BASE + 2],
      "#a9a290",
      r,
      { blob: 5, shadeA: 0.2, lw: 1.2 },
    );
    // the backdrop's opening: a dark recess (the canvas is drawn live), its oak
    // surround, the rollers the canvas winds between
    const [dx, dy, dw, dh] = DROP;
    g.fillStyle = "#3b352c";
    g.fillRect(dx, dy, dw, dh);
    for (const [x0, y0, x1, y1] of [
      [dx - 6, dy - 2, dx, dy + dh + 2],
      [dx + dw, dy - 2, dx + dw + 6, dy + dh + 2],
    ] as const)
      wash(
        g,
        () => {
          g.beginPath();
          g.rect(x0, y0, x1 - x0, y1 - y0);
        },
        [x0, y0, x1, y1],
        OAK,
        r,
        { blob: 4, var: 16, shadeA: 0.25, lw: 1.2 },
      );
    for (const y of [dy - 3.5, dy + dh + 3.5]) {
      seg(g, dx - 9, y, dx + dw + 9, y);
      bar(g, 6, "#8a7558", "rgba(255,244,214,.25)");
      for (const x of [dx - 10, dx + dw + 10]) {
        disc(g, x, y, 4);
        g.fillStyle = BRASS;
        g.fill();
        ink(g, 1);
        g.stroke();
      }
    }
    // the roof screen's gantry: two iron posts off the ridge, stayed
    for (const x of [ROOF_SCREEN[0] - 5, ROOF_SCREEN[0] + ROOF_SCREEN[2] + 5]) {
      seg(g, x, -34 - HALL_H, x, ROOF_TRACK - 2);
      bar(g, 2.2, IRON, "rgba(230,236,240,.2)");
    }
    seg(
      g,
      ROOF_SCREEN[0] - 5,
      ROOF_TRACK + 14,
      ROOF_SCREEN[0] - 22,
      -36 - HALL_H,
    );
    bar(g, 1.4, IRON, null);
    seg(
      g,
      ROOF_SCREEN[0] + ROOF_SCREEN[2] + 5,
      ROOF_TRACK + 14,
      ROOF_SCREEN[0] + ROOF_SCREEN[2] + 22,
      -36 - HALL_H,
    );
    bar(g, 1.4, IRON, null);
    // the outboard end of the hall's track: a strut down to the wall, a stop at the end
    seg(g, L - OUTBOARD + 2, TRACK - 2.5, L, TRACK + 30);
    bar(g, 2, IRON, null);
    g.fillStyle = IRON;
    g.fillRect(L - OUTBOARD - 2, TRACK - 7, 4, 9);
    // the tracks, on their brackets: the hall's runs on past the tower's corner
    for (const [x0, x1, y] of [
      [L - OUTBOARD, 80, TRACK],
      [48, R - 6, TOWER_TRACK],
      [ROOF_SCREEN[0] - 8, ROOF_SCREEN[0] + ROOF_SCREEN[2] + 8, ROOF_TRACK],
    ] as const) {
      seg(g, x0, y - 2.5, x1, y - 2.5);
      bar(g, 2.4, IRON, "rgba(230,236,240,.25)");
      for (let x = x0 + 4; x < x1; x += 30) rivet(g, x, y - 6, 1.3);
    }
    // the tower's own window, under the screen
    windowRect(g, 82, -92, 24, 40, r, {
      arch: true,
      lit,
      frame: "#4a3a2c",
      sill: "#b3ab98",
    });
    // the door under its canvas awning
    doorArch(g, 0, 0, 34, 58, r, { col: mix(accent(s.hue), "#5e4a36", 0.3) });
    ink(g, 0.9, 0.7);
    hline(g, 0, -56, 0, 0, r, 0.2);
    steps(g, 0, 2, 40, 2, r);
    const awn: Pt[] = [
      [-25, -80],
      [25, -80],
      [33, -63],
      [-33, -63],
    ];
    wash(g, () => poly(g, awn), bbox(awn), "#cdc2a4", r, {
      blob: 5,
      var: 16,
      shadeA: 0.2,
      lw: 1.2,
    });
    g.save();
    poly(g, awn);
    g.clip();
    g.fillStyle = headPaint(s);
    g.globalAlpha = 0.75;
    for (let i = -3; i < 3; i += 2) {
      poly(g, [
        [i * 8.4, -80],
        [(i + 1) * 8.4, -80],
        [(i + 1) * 11, -63],
        [i * 11, -63],
      ]);
      g.fill();
    }
    g.globalAlpha = 1;
    g.restore();
    for (let i = -3; i < 3; i++) {
      g.beginPath();
      g.arc(i * 11 + 5.5, -63, 5.5, 0, Math.PI);
      g.fillStyle = i % 2 ? "#cdc2a4" : mix(headPaint(s), "#cdc2a4", 0.25);
      g.fill();
      ink(g, 0.9, 0.8);
      g.stroke();
    }
    // the shelf either side of the door, on iron brackets, and what stands on it
    for (const [x0, x1] of RUNS) {
      g.fillStyle = "rgba(24,20,14,.3)";
      g.fillRect(x0 + 2, SHELF + 5, x1 - x0, 5);
      // (its top, seen from above: the board stands out from the wall)
      oblique.onTop(g, SHELF, () => {
        g.fillStyle = "#a08a68";
        g.fillRect(x0, 0, x1 - x0, 7);
        ink(g, 0.9, 0.7);
        g.strokeRect(x0, 0, x1 - x0, 7);
      });
      wash(
        g,
        () => {
          g.beginPath();
          g.rect(x0, SHELF, x1 - x0, 5.5);
        },
        [x0, SHELF, x1, SHELF + 5.5],
        "#8a7355",
        r,
        { blob: 4, var: 18, shadeA: 0.25, lw: 1.2 },
      );
      for (const x of [x0 + 8, (x0 + x1) / 2, x1 - 8]) {
        g.beginPath();
        g.moveTo(x, SHELF + 5.5);
        g.lineTo(x, SHELF + 17);
        g.moveTo(x - 7, SHELF + 6);
        g.quadraticCurveTo(x - 6, SHELF + 14, x, SHELF + 16);
        bar(g, 1.5, IRON, null);
      }
    }
    const THINGS = [
      [0, -98, "#7d8f96"],
      [4, -76, "#a8795a"],
      [1, -55, "#6f8562"],
      [3, -38, "#8f7a5c"],
      [2, 42, "#b9ad92"],
      [1, 60, "#8a6d7c"],
      [0, 76, "#b09058"],
    ] as const;
    for (const [kind, x, col] of THINGS) kept(g, r, kind, x, col);
    // the lamp at the shelf's end (its light is drawn live)
    g.fillStyle = IRON;
    g.fillRect(89, SHELF - 3, 10, 3);
    g.fillRect(90, SHELF - 21, 8, 2.5);
    g.beginPath();
    g.arc(94, SHELF - 22, 3.5, Math.PI, 0);
    ink(g, 1.1);
    g.stroke();
    // what grows about
    ivy(g, L + 6, 0, -120, r, 22);
    moss(g, L, R, 1, r, 16);
    tufts(g, L - 8, R + 34, 4, r, 26);
    for (const [x, y, z, k] of [
      [-130, 2, 11, 0],
      [138, -10, 12, 1],
      [-66, 22, 6, 2],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    const paint = headPaint(s);
    const dim = s.night || s.dusk;
    const [dx, dy, dw, dh] = DROP;
    // the backdrop winds on to its next scene
    {
      const n = Math.floor(t / 26);
      const o = ease(clamp01((t - n * 26 - 21) / 5)) * dh;
      g.save();
      g.beginPath();
      g.rect(dx, dy, dw, dh);
      g.clip();
      scene(g, n % 3, dx, dy - o, dw, dh);
      if (o > 0) {
        scene(g, (n + 1) % 3, dx, dy + dh - o, dw, dh);
        g.fillStyle = "#4f4233";
        g.fillRect(dx, dy + dh - o - 1.5, dw, 3);
      }
      // the opening's own shade on the canvas
      const sh = g.createLinearGradient(0, dy, 0, dy + 14);
      sh.addColorStop(0, "rgba(24,20,14,.4)");
      sh.addColorStop(1, "rgba(24,20,14,0)");
      g.fillStyle = sh;
      g.fillRect(dx, dy, dw, 14);
      if (s.night) {
        g.fillStyle = "rgba(20,24,44,.3)";
        g.fillRect(dx, dy, dw, dh);
      }
      g.restore();
      g.strokeStyle = INK;
      g.lineWidth = 1.2;
      g.strokeRect(dx, dy, dw, dh);
    }
    // the screens: the two at the back, then the front one, rolling along the track
    const blind = blindAt(t);
    screen(
      g,
      ROOF_SCREEN[0],
      ROOF_SCREEN[1],
      ROOF_SCREEN[2],
      ROOF_SCREEN[3],
      paint,
      s.night,
      0,
      ROOF_TRACK,
      5,
      null,
    );
    screen(
      g,
      BIG[0],
      BIG[1],
      BIG[2],
      BIG[3],
      paint,
      s.night,
      0,
      TRACK,
      9,
      HALL_WALL,
    );
    screen(
      g,
      SMALL[0],
      SMALL[1],
      SMALL[2],
      SMALL[3],
      paint,
      s.night && blind < 0.5,
      blind,
      TOWER_TRACK,
      7,
      TOWER_WALL,
    );
    screen(
      g,
      frontX(t),
      FRONT.y,
      FRONT.w,
      FRONT.h,
      paint,
      dim,
      0,
      TRACK,
      14,
      HALL_WALL,
    );
    // the shelf's lamp
    {
      const f = 0.75 + 0.15 * Math.sin(t * 6.7) + 0.1 * Math.sin(t * 11.3 + 2);
      g.fillStyle = dim ? "#ffd98a" : "#c9c2a8";
      g.fillRect(90.5, SHELF - 18.5, 7, 15.5);
      if (dim) {
        g.fillStyle = `rgba(255,246,206,${0.6 * f})`;
        g.beginPath();
        g.ellipse(94, SHELF - 9, 1.6, 3.4, 0, 0, TAU);
        g.fill();
      }
      g.strokeStyle = INK;
      g.lineWidth = 0.9;
      g.strokeRect(90.5, SHELF - 18.5, 7, 15.5);
      if (dim) {
        g.save();
        g.globalCompositeOperation = "lighter";
        const gl = g.createRadialGradient(
          94,
          SHELF - 10,
          1,
          94,
          SHELF - 10,
          24,
        );
        gl.addColorStop(0, `rgba(255,210,130,${0.38 * f})`);
        gl.addColorStop(1, "rgba(255,210,130,0)");
        g.fillStyle = gl;
        g.fillRect(70, SHELF - 34, 48, 48);
        g.restore();
      }
    }
  },
};
