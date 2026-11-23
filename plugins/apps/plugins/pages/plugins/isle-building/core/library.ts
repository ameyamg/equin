// Pages' building on Isle: the library of stacked books — three book-shaped
// storeys lying spine-out (boarded spines with raised bands and tarnished
// gilt, striated page-block ends), a thin volume lying between two of them,
// roofed by an open book laid face-down in slate. It is the app at
// work: a note is written line by line on the slate let into the middle spine,
// read, wiped and begun again; the leaf of the book on the lectern turns;
// loose leaves drift down from the roof and lie a while on the grass; the
// ribbon marker stirs.

import {
  accent,
  bbox,
  castShadow,
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
  shingles,
  shrub,
  steps,
  tufts,
  wash,
  windowRect,
  type Box,
  type BuildingSpec,
  type Ctx2D,
  type Pt,
  type Rnd,
} from "@plugins/apps/plugins/isle/plugins/buildings/core";

const {
  TAU,
  INK,
  GILT,
  clamp01,
  ease,
  seg,
  ellShadow,
  bar,
  streaks,
  porthole,
  gust,
  glowPane,
  lengthOf,
  partial,
} = fittings;

const GRAIN_BOX: Box = [-200, -320, 230, 60];

/** How deep every volume is (the roof's ridge runs back a little less). */
const D = 26;
const ROOF_D = 20;

/**
 * One book-shaped storey lying flat, its spine toward us, from x0 to x1 on y0
 * and `h` tall: boarded spine with raised `bands` (their x), a striated
 * page-block end, the cover for a roof.
 */
function book(
  g: Ctx2D,
  r: Rnd,
  x0: number,
  x1: number,
  y0: number,
  h: number,
  col: string,
  bands: readonly number[],
): void {
  const yt = y0 - h;
  const faces = oblique.box({ x0, x1, yb: y0, yt, d: D });
  oblique.fill(g, faces.top, (top) =>
    wash(g, () => poly(g, top), bbox(top), mix(col, "#6c6f73", 0.35), r, {
      blob: 6,
      var: 18,
      shadeA: 0.16,
      lw: 1.4,
    }),
  );
  oblique.fill(g, faces.side, (side) => {
    g.fillStyle = dark(col, 0.4);
    poly(g, side);
    g.fill();
    ink(g, 1.4);
    g.stroke();
  });
  if (h > 12) {
    const b = Math.min(5, h * 0.12);
    // the page block's end, painted flat in side-face space: its leaves run back with the side
    oblique.onSide(g, x1, () => {
      g.save();
      g.beginPath();
      g.rect(1, yt + b, D - 3, h - 2 * b);
      g.fillStyle = "#d3c9ae";
      g.fill();
      g.clip();
      for (let y = y0 - b; y > yt + b; y -= 1.9) {
        g.strokeStyle = `rgba(86,66,38,${0.2 + r() * 0.34})`;
        g.lineWidth = 0.6;
        seg(g, 0, y, D, y + (r() - 0.5) * 0.8);
        g.stroke();
      }
      for (let k = 0; k < 8; k++) {
        g.fillStyle = "rgba(90,74,46,.14)";
        g.beginPath();
        g.ellipse(r() * D, yt + r() * h, 3 + r() * 5, 2 + r() * 4, 0, 0, TAU);
        g.fill();
      }
      const sg = g.createLinearGradient(0, 0, D, 0);
      sg.addColorStop(0, "rgba(40,30,16,.34)");
      sg.addColorStop(0.3, "rgba(40,30,16,.06)");
      sg.addColorStop(1, "rgba(40,30,16,.24)");
      g.fillStyle = sg;
      g.fillRect(0, yt, D, h);
      g.restore();
      g.beginPath();
      g.rect(1, yt + b, D - 3, h - 2 * b);
      ink(g, 0.9, 0.7);
      g.stroke();
    });
  }
  const spine = () => {
    g.beginPath();
    g.roundRect(x0, yt, x1 - x0, h, Math.min(9, h / 3));
  };
  g.save();
  spine();
  g.clip();
  planks(g, x0 - 1, yt - 1, x1 + 1, y0 + 1, r, {
    base: col,
    vertical: false,
    pw: h > 12 ? 7.5 : 4,
  });
  for (let k = 0; k < ((x1 - x0) * h) / 500; k++) {
    g.fillStyle = jit(col, r, 34, 0.2);
    g.beginPath();
    g.ellipse(
      x0 + r() * (x1 - x0),
      yt + r() * h,
      5 + r() * 12,
      3 + r() * 6,
      r() * 3,
      0,
      TAU,
    );
    g.fill();
  }
  streaks(g, r, [x0, yt, x1, y0], (x1 - x0) / 14, "40,32,24", 0.13, h * 0.7);
  const vg = g.createLinearGradient(0, yt, 0, y0);
  vg.addColorStop(0, "rgba(20,14,10,.16)");
  vg.addColorStop(0.14, "rgba(255,246,220,.2)");
  vg.addColorStop(0.5, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(20,14,10,.46)");
  g.fillStyle = vg;
  g.fillRect(x0, yt, x1 - x0, h);
  if (h > 12) {
    g.strokeStyle = GILT;
    g.lineWidth = 1;
    g.globalAlpha = 0.8;
    for (const y of [yt + 4.5, yt + 6.8, y0 - 4.5, y0 - 6.8])
      hline(g, x0 + 3, y, x1 - 3, y, r, 0.4);
    g.globalAlpha = 1;
  }
  for (const bx of bands) {
    g.fillStyle = light(col, 0.16);
    g.fillRect(bx - 4, yt, 8, h);
    g.fillStyle = "rgba(255,246,220,.16)";
    g.fillRect(bx - 4, yt, 2, h);
    g.fillStyle = "rgba(20,14,10,.3)";
    g.fillRect(bx + 1.8, yt, 2.2, h);
    g.fillStyle = "rgba(20,14,10,.22)";
    g.fillRect(bx + 4, yt, 3, h);
    ink(g, 0.8, 0.65);
    hline(g, bx - 4, yt, bx - 4, y0, r, 0.3);
    hline(g, bx + 4, yt, bx + 4, y0, r, 0.3);
    if (h > 12) {
      g.strokeStyle = GILT;
      g.globalAlpha = 0.75;
      g.lineWidth = 0.9;
      hline(g, bx - 7.5, yt + 8, bx - 7.5, y0 - 8, r, 0.3);
      hline(g, bx + 9.5, yt + 8, bx + 9.5, y0 - 8, r, 0.3);
      g.globalAlpha = 1;
    }
  }
  g.restore();
  spine();
  ink(g, 1.6);
  g.stroke();
}

/** A plaque with a gilt rule round it; `title`: its two carved lines too (the slate's are written live instead). */
function plaque(
  g: Ctx2D,
  r: Rnd,
  x: number,
  y: number,
  w: number,
  h: number,
  col: string,
  title: boolean,
): void {
  g.fillStyle = col;
  g.fillRect(x, y, w, h);
  ink(g, 0.9, 0.7);
  g.strokeRect(x, y, w, h);
  g.strokeStyle = GILT;
  g.globalAlpha = 0.7;
  g.lineWidth = 0.9;
  g.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
  if (title) {
    g.lineWidth = 1.2;
    for (const [i, k] of [
      [0, 0.4],
      [1, 0.62],
    ] as const)
      hline(
        g,
        x + w * (0.2 + i * 0.1),
        y + h * k,
        x + w * (0.8 - i * 0.1),
        y + h * k,
        r,
        0.5,
      );
  }
  g.globalAlpha = 1;
}

/** The top book's corner, and the open book roofing it (relative to that corner): eaves, ridge, and the ridge's run back. */
const TX = -96;
const TY = -180;
const E_L: Pt = [-26, -58];
const RIDGE: Pt = [95, -106];
const E_R: Pt = [216, -58];
/** The writing slate on the middle volume: x, y, w, h. */
const SLATE = [-36, -150, 62, 36] as const;
/** What is written on it, line by line, in a running hand. */
const HAND: readonly (readonly Pt[])[] = (
  [
    [7, 9, 48],
    [7, 16, 40],
    [7, 23, 50],
    [7, 30, 24],
  ] as const
).map(([x, y, w]) => {
  const pts: Pt[] = [];
  for (let k = 0; k <= w; k += 1.5)
    pts.push([
      SLATE[0] + x + k,
      SLATE[1] + y + Math.sin(k * 1.9 + y) * 1.4 * (k % 9 < 7 ? 1 : 0.15),
    ]);
  return pts;
});
const HAND_LEN = HAND.map(lengthOf);
/** The lectern in the yard: the middle of its book's gutter, and the half-width and height of a page. */
const DESK: Pt = [178, 16];
const PAGE_W = 22;
const PAGE_H = 19;
/** The loose leaves: from (x, y) under the roof to (x, y) on the grass, and their phase. */
const LEAVES = [
  [-100, -210, -86, 36, 0],
  [76, -200, 110, 34, 6.3],
  [130, -184, 164, 36, 11.6],
] as const;

export const library: BuildingSpec = {
  door: { kind: "leaf", w: 34, h: 58, arch: true },
  footprint: {
    w: 256,
    depth: 96,
    ground: [-177, -112, 211, 45],
    upper: [-150, -306, 153, -112],
  },
  setting: ["square", "lane"],
  signX: -166,
  lights: [
    [-81, -48, 16],
    [73, -48, 16],
    [0, -34, 18],
    [-67, -125, 11],
    [53, -125, 11],
    [-51, -202, 10],
    [49, -202, 10],
    [-1, -242, 8],
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const A = accent(s.hue);
    const C1 = mix(A, "#7d7f86", 0.3);
    const C2 = "#7b5446";
    const C3 = "#97815a";
    const SL = "#6c6f73";
    castShadow(
      g,
      [
        [-124, 5],
        [128, 5],
        [186, 28],
        [192, -18],
        [150, -28],
      ],
      0.3,
    );
    // bottom volume: the door is in its spine
    book(g, r, -134, 122, 0, 94, C1, [-118, -48, 48, 106]);
    windowRect(g, -92, -28, 22, 40, r, {
      arch: true,
      lit,
      frame: "#4a3a2c",
      sill: "#b3ab98",
    });
    windowRect(g, 62, -28, 22, 40, r, {
      arch: true,
      lit,
      frame: "#4a3a2c",
      sill: "#b3ab98",
    });
    doorArch(g, 0, 0, 34, 58, r, { col: "#6a5038" });
    ink(g, 0.9, 0.7);
    hline(g, 0, -56, 0, 0, r, 0.2);
    steps(g, 0, 2, 42, 2, r);
    // second volume, worn oxblood boards, with the writing slate let into its spine
    book(g, r, -112, 100, -100, 60, C2, [-90, 78]);
    plaque(g, r, SLATE[0], SLATE[1], SLATE[2], SLATE[3], "#33383a", false);
    windowRect(g, -74, -112, 14, 26, r, {
      arch: true,
      lit,
      frame: "#3e2c24",
      sill: "#b3ab98",
    });
    windowRect(g, 46, -112, 14, 26, r, {
      arch: true,
      lit,
      frame: "#3e2c24",
      sill: "#b3ab98",
    });
    // a thin one lying between, and the third volume on it
    book(g, r, -104, 88, -166, 8, "#66705c", []);
    g.save();
    g.translate(TX, TY);
    book(g, r, 0, 190, 0, 48, C3, [24, 166]);
    windowRect(g, 38, -10, 14, 24, r, {
      arch: true,
      lit,
      frame: "#4a3a2c",
      sill: "#b3ab98",
    });
    windowRect(g, 138, -10, 14, 24, r, {
      arch: true,
      lit,
      frame: "#4a3a2c",
      sill: "#b3ab98",
    });
    plaque(g, r, 72, -38, 46, 24, "#6a4034", true);
    // the roof: an open book laid face-down — slate covers, the spine for a ridge, the page block for eaves
    const gab: Pt[] = [
      [-2, -48],
      [RIDGE[0], RIDGE[1] + 20],
      [192, -48],
    ];
    wash(g, () => poly(g, gab), bbox(gab), "#c9bea2", r, {
      blob: 6,
      var: 16,
      shadeA: 0.2,
      lw: 1.2,
    });
    g.fillStyle = "rgba(30,24,16,.3)";
    poly(g, [
      [-2, -48],
      [RIDGE[0], RIDGE[1] + 20],
      [192, -48],
      [176, -48],
      [RIDGE[0], RIDGE[1] + 28],
      [14, -48],
    ]);
    g.fill();
    porthole(g, RIDGE[0], -62, 7, lit);
    oblique.fill(g, oblique.extrude(E_L, RIDGE, ROOF_D), (slopeL) =>
      shingles(g, slopeL, r, { base: SL, rowH: 6, w: 10 }),
    );
    oblique.fill(g, oblique.extrude(RIDGE, E_R, ROOF_D), (slopeR) =>
      shingles(g, slopeR, r, {
        base: "#5f6266",
        rowH: 6,
        w: 10,
        shadeSide: slopeR,
      }),
    );
    const ridgeEnd = oblique.back(RIDGE, ROOF_D);
    seg(g, RIDGE[0], RIDGE[1], ridgeEnd[0], ridgeEnd[1]);
    bar(g, 5.5, "#53565b", "rgba(230,236,240,.2)");
    const pgs: Pt[] = [
      [E_L[0] + 2, E_L[1] + 4],
      [RIDGE[0], RIDGE[1] + 4],
      [E_R[0] - 2, E_R[1] + 4],
      [E_R[0] - 2, E_R[1] + 20],
      [RIDGE[0], RIDGE[1] + 20],
      [E_L[0] + 2, E_L[1] + 20],
    ];
    g.save();
    poly(g, pgs);
    g.fillStyle = "#cfc5aa";
    g.fill();
    g.clip();
    for (let k = 1; k < 8; k++) {
      g.strokeStyle = `rgba(86,70,44,${0.22 + r() * 0.3})`;
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(E_L[0], E_L[1] + 4 + k * 2);
      g.lineTo(RIDGE[0], RIDGE[1] + 4 + k * 2);
      g.lineTo(E_R[0], E_R[1] + 4 + k * 2);
      g.stroke();
    }
    for (let k = 0; k < 26; k++) {
      g.fillStyle = "rgba(70,60,40,.12)";
      g.beginPath();
      g.ellipse(
        E_L[0] + r() * 242,
        RIDGE[1] + r() * 70,
        3 + r() * 8,
        2 + r() * 3,
        0,
        0,
        TAU,
      );
      g.fill();
    }
    g.fillStyle = "rgba(40,30,16,.18)";
    g.fillRect(RIDGE[0], RIDGE[1], 130, 80);
    g.restore();
    poly(g, pgs);
    ink(g, 1.1);
    g.stroke();
    g.fillStyle = dark(SL, 0.3);
    poly(g, [
      E_L,
      RIDGE,
      E_R,
      [E_R[0], E_R[1] + 4.5],
      [RIDGE[0], RIDGE[1] + 4.5],
      [E_L[0], E_L[1] + 4.5],
    ]);
    g.fill();
    ink(g, 1.4);
    g.stroke();
    g.restore();
    // the lectern in the yard, a big book open on it (its leaf turns)
    ellShadow(g, DESK[0] + 8, DESK[1] + 22, 19, 4, 0.24);
    g.fillStyle = "#6e573f";
    g.fillRect(DESK[0] - 3, DESK[1] - 2, 6, 24);
    ink(g, 1);
    g.strokeRect(DESK[0] - 3, DESK[1] - 2, 6, 24);
    g.fillRect(DESK[0] - 11, DESK[1] + 20, 22, 3.5);
    g.strokeRect(DESK[0] - 11, DESK[1] + 20, 22, 3.5);
    const lec: Pt[] = [
      [DESK[0] - PAGE_W - 4, DESK[1] - 2],
      [DESK[0] + PAGE_W + 4, DESK[1] - 2],
      [DESK[0] + PAGE_W, DESK[1] - PAGE_H - 8],
      [DESK[0] - PAGE_W, DESK[1] - PAGE_H - 8],
    ];
    wash(g, () => poly(g, lec), bbox(lec), "#7d6648", r, {
      blob: 4,
      var: 16,
      shadeA: 0.2,
      lw: 1.3,
    });
    for (const d of [-1, 1]) {
      g.fillStyle = d < 0 ? "#ddd3b8" : "#cdc3a8";
      poly(g, [
        [DESK[0], DESK[1] - 4],
        [DESK[0] + d * PAGE_W, DESK[1] - 5.5],
        [DESK[0] + d * (PAGE_W - 2), DESK[1] - 6.5 - PAGE_H],
        [DESK[0], DESK[1] - 4 - PAGE_H],
      ]);
      g.fill();
      ink(g, 0.9, 0.8);
      g.stroke();
      ink(g, 0.5, 0.45);
      for (let k = 0; k < 5; k++)
        hline(
          g,
          DESK[0] + d * 3,
          DESK[1] - 8 - k * 3.2,
          DESK[0] + d * (PAGE_W - 4),
          DESK[1] - 8.8 - k * 3.2,
          r,
          0.2,
        );
    }
    ivy(g, -124, 0, -82, r, 18);
    ivy(g, 118, 0, -56, r, 14);
    moss(g, -132, 122, 1, r, 20);
    tufts(g, -134, 126, 3, r, 28);
    for (const [x, y, z, k] of [
      [-158, 8, 15, 0],
      [162, -14, 13, 1],
      [-70, 38, 8, 2],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    // a note being written on the slate, line by line in a running hand; read; wiped; the next note
    {
      const c = t % 21;
      const a = c < 16.5 ? 1 : clamp01((18 - c) / 1.5);
      const pens: Pt[] = [];
      g.save();
      g.lineCap = "round";
      g.lineJoin = "round";
      g.strokeStyle = `rgba(226,214,180,${0.9 * a})`;
      g.lineWidth = 1.2;
      HAND.forEach((line, i) => {
        const done = (c - i * 3.3) * 20;
        if (done <= 0) return;
        const p = partial(g, line, done);
        if (p && done < HAND_LEN[i]!) pens.push(p);
      });
      const at = pens[pens.length - 1];
      if (at) {
        // the quill, on the line it is writing
        g.fillStyle = "#e9e2cf";
        g.strokeStyle = INK;
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(at[0], at[1]);
        g.quadraticCurveTo(at[0] + 9, at[1] - 8, at[0] + 9, at[1] - 19);
        g.quadraticCurveTo(at[0] + 2, at[1] - 10, at[0], at[1]);
        g.closePath();
        g.fill();
        g.stroke();
      }
      g.restore();
    }
    // the leaf of the book on the lectern turns: read a while, turn, read
    {
      const u = ease(clamp01(((t % 7.2) - 5.6) / 1.4));
      if (u > 0 && u < 1) {
        const th = u * Math.PI;
        const tx = DESK[0] + Math.cos(th) * PAGE_W;
        const lift = Math.sin(th) * 11;
        g.beginPath();
        g.moveTo(DESK[0], DESK[1] - 4);
        g.quadraticCurveTo(
          (DESK[0] + tx) / 2,
          DESK[1] - 5 - lift * 1.3,
          tx,
          DESK[1] - 5.5 - lift * 0.5,
        );
        g.lineTo(tx - Math.cos(th) * 2, DESK[1] - 6.5 - PAGE_H - lift * 0.5);
        g.quadraticCurveTo(
          (DESK[0] + tx) / 2,
          DESK[1] - 5 - PAGE_H - lift * 1.3,
          DESK[0],
          DESK[1] - 4 - PAGE_H,
        );
        g.closePath();
        g.fillStyle = "#ebe3cc";
        g.fill();
        g.strokeStyle = INK;
        g.lineWidth = 0.9;
        g.lineJoin = "round";
        g.stroke();
      }
    }
    // the bookmark ribbon out of the top book, stirring
    g.save();
    g.translate(TX, TY);
    g.lineJoin = "round";
    g.lineCap = "round";
    const rx0 = 200;
    const ry0 = -30;
    const gu = 0.4 + Math.max(0, gust(t, 0.9));
    g.beginPath();
    g.moveTo(rx0 - 8, ry0 - 6);
    for (let k = 0; k <= 10; k++) {
      const u = k / 10;
      g.lineTo(
        rx0 + 5 * Math.sin(u * 2.4) + Math.sin(t * 1.5 - u * 3) * 5 * u * gu,
        ry0 + u * 72,
      );
    }
    g.strokeStyle = "rgba(48,38,28,.85)";
    g.lineWidth = 8;
    g.stroke();
    g.strokeStyle = "#96463a";
    g.lineWidth = 6;
    g.stroke();
    g.strokeStyle = "rgba(255,230,200,.25)";
    g.lineWidth = 1.2;
    g.stroke();
    g.restore();
    // someone reading by candle
    glowPane(g, s, -72, -136, 10, 22, 0.2);
    glowPane(g, s, 64, -66, 18, 36, 3.6);
  },
  // what drifts loose of it: never part of its shape
  ambient(g, s) {
    const t = s.t;
    // loose leaves let go from the roof-book, drifting down, lying a while on the grass
    LEAVES.forEach(([x0, y0, x1, y1, ph], i) => {
      const c = (t + ph) % 17.5;
      const u = clamp01(c / 6.5);
      const a = c < 13 ? Math.min(1, c * 2) : clamp01((14.5 - c) / 1.5);
      if (a <= 0) return;
      const e = u * u * 0.4 + u * 0.6;
      const x = x0 + (x1 - x0) * e + 16 * Math.sin(u * 9 + i) * (1 - u);
      const y = y0 + (y1 - y0) * e;
      const ro = u < 1 ? Math.sin(u * 14 + i * 2) * 0.9 : 0.15;
      const sq = u < 1 ? 0.55 + 0.45 * Math.cos(u * 11 + i) : 0.4;
      g.save();
      g.globalAlpha = a;
      g.translate(x, y);
      g.rotate(ro);
      g.scale(1, sq);
      g.fillStyle = "#e9e1ca";
      g.fillRect(-6.5, -4.5, 13, 9);
      g.strokeStyle = INK;
      g.lineWidth = 0.8;
      g.strokeRect(-6.5, -4.5, 13, 9);
      g.strokeStyle = "rgba(70,56,36,.5)";
      g.lineWidth = 0.5;
      seg(g, -4, -1.5, 4, -1.5);
      g.stroke();
      seg(g, -4, 1.5, 3, 1.5);
      g.stroke();
      g.restore();
    });
  },
};
