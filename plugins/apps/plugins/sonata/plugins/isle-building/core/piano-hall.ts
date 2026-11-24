// Sonata's building on Isle: the piano hall — a concert hall built as a grand
// piano. The dark lacquered case stands on turned legs over a stone room, the
// keyboard is a deep awning over the door, the gilded plate and strings lie
// open under the propped lid, which shows its ribbed underside from the
// keyboard. A slow phrase plays: keys dip, their hammers jump and their strings
// ring; a metronome ticks on the terrace and the sheet on the music stand turns
// in the bar's rest.

import {
  accent,
  bbox,
  bench,
  castShadow,
  doorArch,
  fittings,
  grain,
  hline,
  ink,
  ivy,
  jit,
  lantern,
  mix,
  moss,
  oblique,
  poly,
  shrub,
  steps,
  stones,
  tufts,
  wash,
  windowRect,
  type Box,
  type BuildingSpec,
  type Ctx2D,
  type P3,
  type Pt,
} from "@plugins/apps/plugins/isle/plugins/buildings/core";

const { TAU, BRASS, BRASS_D, BRASS_L, IRON, disc, seg, bar, rivet, streaks } =
  fittings;

const GRAIN_BOX: Box = [-200, -350, 230, 54];
const LACQUER = "#3a2e27";

// The case in plan: u across (-1 the bass spine … 1 the treble cheek), v deep
// (0 the keyboard … 1 the tail), DZ px deep. Every point is placed by the
// kit's projection (`oblique.at`), so the case recedes as every building does.
/** Half width; the depth, and what it comes to on screen; the rim's and the keybed's heights; the lid's angle and reach. */
const W = 116;
const DZ = 74;
const DX = DZ;
const DY = oblique.rise(DZ);
const HC = 150;
const HK = 74;
const TH = 1.1;
const LID_REACH = 0.78;

/** How deep the case runs at `u`: the tail on the bass side, the bentside's S toward the treble. */
const backV = (u: number): number =>
  u <= -0.45
    ? 1
    : 1 -
      0.62 * (0.5 - 0.5 * Math.cos(Math.PI * Math.pow((u + 0.45) / 1.45, 0.9)));

const PLAN: readonly Pt[] = (() => {
  const p: Pt[] = [
    [-1, 0],
    [-1, 0.93],
    [-0.94, 1],
  ];
  for (let u = -0.45; u < 1; u += 0.05) p.push([u, backV(u)]);
  p.push([1, backV(1)], [1, 0]);
  return p;
})();

/** A plan point on the rim (or `h` above the ground), in space and on screen. */
const top3 = ([u, v]: Pt, h = HC): P3 => [u * W, v * DZ, h];
const top = (p: Pt, h = HC): Pt => oblique.at(...top3(p, h));
/** A plan point set in from the rim: the plate inside it. */
const inner = ([u, v]: Pt): Pt => [u * 0.94, 0.07 + v * 0.86];
/** A plan point on the lid, swung up about the spine. */
const lid3 = ([u, v]: Pt): P3 => {
  const d = (u + 1) * W * LID_REACH;
  return [-W + d * Math.cos(TH), v * DZ, HC + d * Math.sin(TH)];
};
const lid = (p: Pt): Pt => oblique.at(...lid3(p));

const RIM = oblique.project(PLAN.map((p) => top3(p)));
const LOW = oblique.project(PLAN.map((p) => top3(p, HK)));
const INNER = oblique.project(PLAN.map((p) => top3(inner(p))));
const LID = oblique.project(PLAN.map((p) => lid3(p)));

// The keyboard: 36 white keys (five octaves from C), black keys in twos and threes.
const NK = 36;
const KX = -(W - 10);
const KL = 2 * (W - 10);
const KW = KL / NK;
const KT = -96;
const KF = -80;
const keyU = (i: number): number => -0.86 + (1.72 * i) / (NK - 1);
const hasBlack = (i: number): boolean =>
  i < NK - 1 && [0, 1, 3, 4, 5].includes(i % 7);

/** A slow phrase: the left hand on the beat, the right in quavers, then a bar's rest (the page turns). */
const PHRASE: readonly (readonly number[])[] = [
  [11, 20],
  [22],
  [25],
  [22],
  [8, 21],
  [23],
  [25],
  [23],
  [9, 20],
  [23],
  [27],
  [23],
  [8, 19],
  [22],
  [26],
  [22],
  [4, 18, 20, 22],
  [],
  [],
  [],
];
const STEP = 0.62;

const STAND: Pt = [-58, 32];
const METRO: Pt = [68, 30];

/** Adds `q` to the current path wound one way, so overlapping rings never cancel under the nonzero rule. */
function ring(g: Ctx2D, q: readonly Pt[]): void {
  let area = 0;
  q.forEach((a, i) => {
    const b = q[(i + 1) % q.length] ?? a;
    area += a[0] * b[1] - b[0] * a[1];
  });
  const o = area < 0 ? [...q].reverse() : q;
  o.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

/** The case's walls: the rim swept down to the keybed's height. */
function sweep(g: Ctx2D): void {
  g.beginPath();
  const n = RIM.length;
  RIM.forEach((a, i) => {
    const j = (i + 1) % n;
    const b = RIM[j];
    const c = LOW[j];
    const d = LOW[i];
    if (b && c && d) ring(g, [a, b, c, d]);
  });
  ring(g, LOW);
}

export const pianoHall: BuildingSpec = {
  door: { kind: "leaf", w: 32, h: 56, head: 16 },
  footprint: {
    w: 232,
    depth: 70,
    ground: [-160, -112, 220, 44],
    upper: [-122, -333, 146, -112],
  },
  setting: ["square"],
  signX: -176,
  lights: [
    [0, -30, 18],
    [-80, -122, 11],
    [0, -122, 12],
    [80, -122, 11],
    [-64, -40, 12],
    [64, -40, 12],
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const A = accent(s.hue);
    castShadow(
      g,
      [
        [-108, 3],
        [112, 3],
        [160, 22],
        [206, 10],
        [200, -30],
        [150, -52],
        [126, -18],
      ],
      0.26,
    );
    // the stone room the piano stands over, between its legs; its right wall recedes with everything else
    oblique.onSide(g, 100, () =>
      stones(g, 0, -76, 24, 0, r, { rowH: 9, blockW: 14, base: "#8f8878" }),
    );
    oblique.shadeFace(g, oblique.sideFace(100, 0, -76, 24), 0.3);
    stones(g, -100, -78, 100, 0, r, { rowH: 10, blockW: 20, base: "#b9b19e" });
    g.fillStyle = "rgba(30,26,20,.36)";
    g.fillRect(-100, -78, 200, 14);
    g.fillStyle = "rgba(30,26,20,.16)";
    g.fillRect(-100, -64, 200, 8);
    windowRect(g, -76, -24, 22, 30, r, { lit, sill: "#a49d8c" });
    windowRect(g, 54, -24, 22, 30, r, { lit, sill: "#a49d8c" });
    doorArch(g, 0, 0, 32, 56, r, { col: A });
    // the pedal lyre: two brass posts either side of the door, a rail across
    for (const x of [-23, 23]) {
      seg(g, x, -1, x, -68);
      bar(g, 3, BRASS, BRASS_L);
    }
    seg(g, -24, -62, 24, -62);
    bar(g, 2.2, BRASS_D, BRASS);
    lantern(g, -36, -34, lit);
    lantern(g, 36, -34, lit);
    // turned legs on stone pads
    for (const x of [-108, 108]) {
      const leg = () => {
        g.beginPath();
        g.moveTo(x - 8, -68);
        g.lineTo(x + 8, -68);
        g.lineTo(x + 8, -58);
        g.bezierCurveTo(x + 12, -48, x + 9.5, -32, x + 4.5, -20);
        g.lineTo(x + 3.5, -7);
        g.lineTo(x - 3.5, -7);
        g.lineTo(x - 4.5, -20);
        g.bezierCurveTo(x - 9.5, -32, x - 12, -48, x - 8, -58);
        g.closePath();
      };
      g.fillStyle = jit("#a59d8b", r, 14);
      g.fillRect(x - 9, -3, 18, 6);
      ink(g, 1, 0.7);
      g.strokeRect(x - 9, -3, 18, 6);
      wash(g, leg, [x - 12, -68, x + 12, -7], LACQUER, r, {
        blob: 4,
        var: 24,
        lw: 1.3,
      });
      g.fillStyle = BRASS;
      g.fillRect(x - 4.5, -8, 9, 5);
      ink(g, 0.8, 0.8);
      g.strokeRect(x - 4.5, -8, 9, 5);
      g.strokeStyle = "rgba(220,200,170,.25)";
      g.lineWidth = 1.4;
      seg(g, x - 5, -60, x - 6.5, -40);
      g.stroke();
    }
    // (the case, the plate and the lid are faces of the projected plan)
    oblique.fill(g, RIM, () => {
      // the case: the rim swept down from its plan — dark lacquered boards, worn to the wood in places
      const sweepBox: Box = [-W, -HC - DY, W + DX, -HK];
      wash(g, () => sweep(g), sweepBox, LACQUER, r, {
        var: 22,
        blob: 12,
        outline: false,
        shadeA: 0.3,
      });
      g.save();
      sweep(g);
      g.clip();
      for (let i = 0; i < 80; i++) {
        g.fillStyle =
          r() < 0.5
            ? `rgba(126,98,68,${0.1 + r() * 0.16})`
            : `rgba(20,16,14,${0.1 + r() * 0.14})`;
        g.beginPath();
        g.ellipse(
          -W + r() * (2 * W + DX),
          -HC - 30 + r() * 110,
          5 + r() * 16,
          2 + r() * 4,
          0,
          0,
          TAU,
        );
        g.fill();
      }
      ink(g, 0.6, 0.3);
      for (let y = -HC + 9; y < -HK; y += 9) hline(g, -W, y, W, y, r, 0.5);
      streaks(g, r, sweepBox, 24, "20,16,12", 0.16, 34);
      streaks(g, r, sweepBox, 12, "190,170,140", 0.08, 26);
      // the right flank in shade
      g.fillStyle = "rgba(16,12,10,.36)";
      g.beginPath();
      g.moveTo(W, -HK);
      g.lineTo(W, -HC);
      g.lineTo(W + DX, -HC - DY);
      g.lineTo(W + DX, -HK - DY);
      g.closePath();
      g.fill();
      const gl = g.createLinearGradient(0, -HC, 0, -HC + 16);
      gl.addColorStop(0, "rgba(214,206,190,.2)");
      gl.addColorStop(1, "rgba(214,206,190,0)");
      g.fillStyle = gl;
      g.fillRect(-W, -HC, 2 * W, 16);
      g.restore();
      poly(g, LOW);
      ink(g, 1.5);
      g.stroke();
      const xr = top([1, backV(1)]);
      seg(g, xr[0], xr[1], xr[0], xr[1] + HC - HK);
      g.stroke();
      seg(g, W, -HC, W, -HK);
      ink(g, 1, 0.6);
      g.stroke();
      // the fallboard's windows
      for (const x of [-80, -40, 0, 40, 80])
        windowRect(g, x - 8, -110, 16, 24, r, {
          lit,
          frame: "#241d19",
          sill: BRASS_D,
        });
      // the keyboard: a deep awning of painted boards over the door
      g.fillStyle = "#241d19";
      g.fillRect(-W - 2, -76, 2 * W + 4, 9);
      ink(g, 1.2);
      g.strokeRect(-W - 2, -76, 2 * W + 4, 9);
      g.fillStyle = BRASS;
      g.fillRect(-3.5, -74, 7, 4.5);
      ink(g, 0.6, 0.8);
      g.strokeRect(-3.5, -74, 7, 4.5);
      for (let i = 0; i < NK; i++) {
        const x = KX + i * KW;
        g.fillStyle = jit("#e2d8bc", r, 16);
        g.fillRect(x, KT, KW, KF - KT);
        g.fillStyle = jit("#b9ad8e", r, 10);
        g.fillRect(x, KF, KW, 4);
        if (r() < 0.3) {
          g.fillStyle = "rgba(120,96,60,.22)";
          g.fillRect(x + 0.6, KT + 3 + r() * 8, KW - 1.2, 2 + r() * 4);
        }
      }
      ink(g, 0.6, 0.6);
      for (let i = 0; i <= NK; i++) {
        seg(g, KX + i * KW, KT, KX + i * KW, KF + 4);
        g.stroke();
      }
      seg(g, KX, KF, KX + KL, KF);
      ink(g, 0.6, 0.4);
      g.stroke();
      for (let i = 0; i < NK; i++)
        if (hasBlack(i)) {
          const x = KX + (i + 1) * KW;
          g.fillStyle = "#1f1a17";
          g.fillRect(x - 2, KT - 2, 4, 12);
          g.fillStyle = "rgba(255,244,220,.28)";
          g.fillRect(x - 1.4, KT - 1.4, 1, 10);
          g.fillStyle = "rgba(30,24,18,.3)";
          g.fillRect(x + 2, KT, 1, 11);
        }
      const fs = g.createLinearGradient(0, KT, 0, KT + 5);
      fs.addColorStop(0, "rgba(20,16,12,.5)");
      fs.addColorStop(1, "rgba(20,16,12,0)");
      g.fillStyle = fs;
      g.fillRect(KX, KT, KL, 5);
      // the felt strip behind the keys, in the app's colour
      g.fillStyle = mix(A, "#7a5a5a", 0.25);
      g.fillRect(KX, KT - 3.2, KL, 2.6);
      ink(g, 1.1);
      g.strokeRect(KX, KT, KL, KF - KT + 4);
      for (const [x0, x1] of [
        [-W - 2, -W + 10],
        [W - 10, W + 2],
      ] as const) {
        g.fillStyle = "#2c2420";
        g.fillRect(x0, -100, x1 - x0, 33);
        ink(g, 1.2);
        g.strokeRect(x0, -100, x1 - x0, 33);
        g.fillStyle = "rgba(230,214,190,.16)";
        g.fillRect(x0 + 1, -99, x1 - x0 - 2, 2);
      }
      // the keyboard stands out from the case: its right cheek's end, and the keybed's under it
      for (const [yb, yt] of [
        [-67, -100],
        [-67, -76],
      ] as const) {
        const end = oblique.sideFace(W + 2, yb, yt, 12);
        oblique.fill(g, end, (pts) => {
          g.fillStyle = "#17120f";
          poly(g, pts);
          g.fill();
        });
        oblique.inkFace(g, end, 1.1);
      }
      // the open top: the rim, the gilded plate and its strings — a standing-seam roof that happens to be a harp
      wash(g, () => poly(g, RIM), bbox(RIM), "#4a3c31", r, {
        var: 18,
        blob: 8,
        lw: 1.5,
        shadeA: 0.1,
      });
      wash(g, () => poly(g, INNER), bbox(INNER), "#a88f56", r, {
        var: 30,
        blob: 9,
        lw: 1.1,
        shadeA: 0.3,
      });
      g.save();
      poly(g, INNER);
      g.clip();
      for (let i = 0; i < 60; i++) {
        g.fillStyle =
          r() < 0.5
            ? `rgba(104,138,120,${0.12 + r() * 0.2})`
            : `rgba(90,64,34,${0.12 + r() * 0.18})`;
        g.beginPath();
        g.ellipse(
          -W + r() * (2 * W + DX),
          -HC - r() * DY,
          4 + r() * 9,
          2 + r() * 4,
          r() * 3,
          0,
          TAU,
        );
        g.fill();
      }
      // the plate's bracing bars and round holes
      for (const [u0, v0, u1, v1] of [
        [-0.52, 0.1, -0.6, 0.95],
        [-0.05, 0.1, -0.2, 0.93],
        [0.42, 0.1, 0.3, 0.66],
      ] as const) {
        const a = top(inner([u0, v0]));
        const b = top(inner([u1, v1]));
        seg(g, a[0], a[1], b[0], b[1]);
        bar(g, 3, "#8a7444", "rgba(240,224,170,.4)");
      }
      for (const [u, v] of [
        [-0.76, 0.84],
        [-0.4, 0.86],
        [0.02, 0.74],
      ] as const) {
        const p = top(inner([u, v]));
        g.fillStyle = "#3c3020";
        g.beginPath();
        g.ellipse(p[0], p[1], 6, 2.6, 0, 0, TAU);
        g.fill();
        ink(g, 0.7, 0.7);
        g.stroke();
      }
      // strings (seams), the long bass ones to the tail
      for (let k = 0; k < 56; k++) {
        const u = -0.9 + (1.8 * k) / 55;
        const a = top(inner([u, 0.2]));
        const b = top(inner([u, backV(u) - 0.08]));
        g.strokeStyle = "rgba(60,46,26,.5)";
        g.lineWidth = 0.7;
        seg(g, a[0], a[1], b[0], b[1]);
        g.stroke();
        g.strokeStyle = "rgba(255,244,206,.34)";
        g.lineWidth = 0.5;
        seg(g, a[0] - 0.7, a[1], b[0] - 0.7, b[1]);
        g.stroke();
      }
      // the bridge following the curve, the damper rail, the pin block
      g.beginPath();
      for (let k = 0; k <= 18; k++) {
        const u = -0.9 + k * 0.1;
        const p = top(inner([u, backV(u) - 0.14]));
        if (k === 0) g.moveTo(p[0], p[1]);
        else g.lineTo(p[0], p[1]);
      }
      bar(g, 1.8, "#6e5a36", null);
      const d0 = top(inner([-0.94, 0.2]));
      const d1 = top(inner([0.94, 0.2]));
      seg(g, d0[0], d0[1], d1[0], d1[1]);
      bar(g, 2.4, "#2c2420", null);
      for (let k = 0; k < 56; k++) {
        const p = top(inner([-0.9 + (1.8 * k) / 55, (k % 2) * 0.03]));
        rivet(g, p[0], p[1] - 1.5, 0.8);
      }
      // the lid's shadow along the spine
      const s0 = top([-1, 0.5]);
      const lsh = g.createLinearGradient(s0[0], 0, s0[0] + 80, 0);
      lsh.addColorStop(0, "rgba(18,14,10,.55)");
      lsh.addColorStop(1, "rgba(18,14,10,0)");
      g.fillStyle = lsh;
      g.fillRect(-W, -HC - DY, 2 * W, DY + 10);
      if (lit) {
        g.fillStyle = "rgba(255,206,120,.16)";
        g.fillRect(-W, -HC - DY, 2 * W + DX, DY);
      }
      g.restore();
      // the hammer rail (the hammers themselves move)
      const h0 = top(inner([-0.94, 0.1]));
      const h1 = top(inner([0.94, 0.1]));
      seg(g, h0[0], h0[1], h1[0], h1[1]);
      bar(g, 2, "#5a4632", null);
      // the prop stick, then the lid: one great leaf of lacquered boards hinged on the spine
      const st0 = top([0.9, 0.2]);
      const st1 = lid([0.5, 0.2]);
      seg(g, st0[0], st0[1], st1[0], st1[1]);
      bar(g, 3.2, "#3c3028", "rgba(220,200,170,.3)");
      disc(g, st0[0], st0[1], 2.6);
      g.fillStyle = BRASS;
      g.fill();
      ink(g, 0.8);
      g.stroke();
      // (seen from the keyboard it shows its underside: paler boards on ribs, the gilt of the plate caught in the polish)
      const edge = LID.map(([x, y]): Pt => [x - 4, y + 2.5]);
      g.fillStyle = "#1d1815";
      poly(g, edge);
      g.fill();
      ink(g, 1.4);
      g.stroke();
      const lb = bbox(LID);
      wash(g, () => poly(g, LID), lb, "#4b3a2e", r, {
        var: 22,
        blob: 14,
        lw: 1.6,
        shadeA: 0.24,
      });
      g.save();
      poly(g, LID);
      g.clip();
      for (let i = 0; i < 80; i++) {
        g.fillStyle =
          r() < 0.45
            ? `rgba(146,116,80,${0.1 + r() * 0.16})`
            : r() < 0.5
              ? `rgba(18,14,12,${0.12 + r() * 0.14})`
              : `rgba(150,160,160,${0.05 + r() * 0.07})`;
        g.beginPath();
        g.ellipse(
          lb[0] + r() * (lb[2] - lb[0]),
          lb[1] + r() * (lb[3] - lb[1]),
          3 + r() * 7,
          5 + r() * 16,
          0.3,
          0,
          TAU,
        );
        g.fill();
      }
      ink(g, 0.6, 0.34);
      for (let k = 0; k < 16; k++) {
        const u = -0.88 + k * 0.12;
        const a = lid([u, 0]);
        const b = lid([u, backV(u)]);
        hline(g, a[0], a[1], b[0], b[1], r, 0.5);
      }
      for (const v of [0.22, 0.5, 0.76]) {
        const a = lid([-0.96, v]);
        const b = lid([Math.min(0.9, 1.9 - 2.6 * v), v]);
        seg(g, a[0], a[1], b[0], b[1]);
        bar(g, 2.6, "#3a2d24", "rgba(220,200,170,.22)");
      }
      const gls = g.createLinearGradient(0, lb[3], 0, lb[1]);
      gls.addColorStop(0, "rgba(214,180,96,.3)");
      gls.addColorStop(0.4, "rgba(214,180,96,.06)");
      gls.addColorStop(1, "rgba(200,208,210,.1)");
      g.fillStyle = gls;
      g.fillRect(lb[0], lb[1], lb[2] - lb[0], lb[3] - lb[1]);
      streaks(g, r, lb, 20, "16,12,10", 0.14, 34);
      g.restore();
      for (const v of [0.16, 0.5, 0.84]) {
        const p = lid([-1, v]);
        g.fillStyle = BRASS;
        g.fillRect(p[0] - 1.5, p[1] - 4, 6, 5);
        ink(g, 0.7, 0.8);
        g.strokeRect(p[0] - 1.5, p[1] - 4, 6, 5);
      }
    });
    // the terrace: steps, the stool, a music stand, a metronome
    steps(g, 0, 3, 38, 2, r);
    bench(g, -100, 26, 30, r);
    const [sx, sy] = STAND;
    // (0.22: an ellShadow at 0.3 stacks to more than SOLID_ALPHA, and the hover outlined it)
    fittings.ellShadow(g, sx + 6, sy + 1, 11, 2.8, 0.22);
    g.strokeStyle = IRON;
    g.lineWidth = 1.8;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(sx, sy - 2);
    g.lineTo(sx, sy - 31);
    g.moveTo(sx - 9, sy);
    g.lineTo(sx, sy - 7);
    g.lineTo(sx + 9, sy);
    g.moveTo(sx, sy - 7);
    g.lineTo(sx + 2.5, sy + 2.5);
    g.stroke();
    const desk: Pt[] = [
      [sx - 19, sy - 50],
      [sx + 19, sy - 50],
      [sx + 17.5, sy - 28],
      [sx - 17.5, sy - 28],
    ];
    g.fillStyle = "#4a3c30";
    poly(g, desk);
    g.fill();
    ink(g, 1);
    g.stroke();
    g.fillStyle = "#3a2e26";
    g.fillRect(sx - 19, sy - 29, 38, 2.8);
    for (const [k, c] of [
      [-1, "#e4dabd"],
      [1, "#d9cfb0"],
    ] as const) {
      const page: Pt[] = [
        [sx, sy - 49],
        [sx + k * 16.5, sy - 47.6],
        [sx + k * 15.6, sy - 30],
        [sx, sy - 30.8],
      ];
      g.fillStyle = c;
      poly(g, page);
      g.fill();
      ink(g, 0.7, 0.75);
      g.stroke();
      g.strokeStyle = "rgba(60,50,40,.55)";
      g.lineWidth = 0.5;
      for (let j = 0; j < 5; j++) {
        seg(
          g,
          sx + k * 2.4,
          sy - 45.4 + j * 3.2,
          sx + k * 14,
          sy - 44.8 + j * 3.2,
        );
        g.stroke();
      }
    }
    const [mx, my] = METRO;
    castShadow(
      g,
      [
        [mx - 12, my],
        [mx + 12, my],
        [mx + 21, my + 6],
        [mx - 2, my + 6],
      ],
      0.3,
    );
    // (its right side: the front's sloping edge going back, in shade)
    const mside = oblique.extrude([mx + 12.5, my], [mx + 6, my - 40], 8);
    oblique.fill(g, mside, (pts) => {
      g.fillStyle = "#4e3a26";
      poly(g, pts);
      g.fill();
    });
    oblique.inkFace(g, mside, 1.1);
    const mb: Pt[] = [
      [mx - 12.5, my],
      [mx + 12.5, my],
      [mx + 6, my - 40],
      [mx - 6, my - 40],
    ];
    wash(g, () => poly(g, mb), bbox(mb), "#7a5c3c", r, {
      blob: 4,
      var: 24,
      lw: 1.3,
    });
    const mf: Pt[] = [
      [mx - 7.4, my - 6.5],
      [mx + 7.4, my - 6.5],
      [mx + 3.4, my - 36.5],
      [mx - 3.4, my - 36.5],
    ];
    g.fillStyle = "#d9cdaa";
    poly(g, mf);
    g.fill();
    ink(g, 0.7, 0.7);
    g.stroke();
    ink(g, 0.5, 0.6);
    for (let y = my - 33; y < my - 9; y += 3) {
      seg(g, mx - 2, y, mx + 2, y);
      g.stroke();
    }
    const mfoot = oblique.sideFace(mx + 13.5, my, my - 5, 9);
    oblique.fill(g, mfoot, (pts) => {
      g.fillStyle = "#3e2e1e";
      poly(g, pts);
      g.fill();
    });
    oblique.inkFace(g, mfoot, 0.9);
    g.fillStyle = "#5a4530";
    g.fillRect(mx - 13.5, my - 5, 27, 5);
    ink(g, 0.9);
    g.strokeRect(mx - 13.5, my - 5, 27, 5);
    g.fillStyle = BRASS;
    g.fillRect(mx - 2, my - 43.5, 4, 3.5);
    ivy(g, -108, -4, -64, r, 10);
    moss(g, -100, 100, 0, r, 14);
    tufts(g, -118, 124, 3, r, 24);
    for (const [x, y, z, k] of [
      [-140, 6, 16, 0],
      [146, 12, 15, 1],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    const c = t / STEP;
    const beat = Math.floor(c);
    const f = c - beat;
    const notes = PHRASE[beat % PHRASE.length] ?? [];
    // down fast, held, let go
    const press =
      f < 0.12 ? f / 0.12 : Math.max(0, 1 - Math.max(0, f - 0.5) / 0.4);
    const ringing = Math.exp(-f * 2.2);
    // the struck strings ring (never over the lid)
    g.save();
    g.beginPath();
    g.rect(-240, -340, 500, 360);
    LID.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.clip("evenodd");
    for (const i of notes) {
      const u = keyU(i) * 0.96;
      const a = top(inner([u, 0.21]));
      const b = top(inner([u, backV(u) - 0.09]));
      const wob = Math.sin(t * 46 + i) * 0.9 * ringing;
      g.strokeStyle = `rgba(255,240,180,${0.9 * ringing})`;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.quadraticCurveTo(
        (a[0] + b[0]) / 2 + wob,
        (a[1] + b[1]) / 2,
        b[0],
        b[1],
      );
      g.stroke();
    }
    g.restore();
    // the hammers: all at rest on their rail but the ones just thrown
    for (let i = 0; i < NK; i++) {
      const p = top(inner([keyU(i) * 0.96, 0.13]));
      const up = notes.includes(i)
        ? (f < 0.1 ? f / 0.1 : Math.max(0, 1 - (f - 0.1) / 0.18)) * 5
        : 0;
      g.fillStyle = "#d8ceb2";
      g.fillRect(p[0] - 1.5, p[1] - 3 - up, 3, 3.4);
      g.strokeStyle = "rgba(48,38,28,.8)";
      g.lineWidth = 0.6;
      g.strokeRect(p[0] - 1.5, p[1] - 3 - up, 3, 3.4);
    }
    // the keys dip
    for (const i of notes) {
      const x = KX + i * KW;
      g.fillStyle = `rgba(70,54,34,${0.42 * press})`;
      g.fillRect(x + 0.4, KT + 0.5, KW - 0.8, KF - KT - 0.5);
      g.fillStyle = `rgba(36,29,25,${press})`;
      g.fillRect(x + 0.4, KF + 4 - 3 * press, KW - 0.8, 3 * press);
      g.fillStyle = "#1f1a17";
      // (the black keys' halves over this one, back on top — from under the felt strip, which lies over their heads)
      if (hasBlack(i)) g.fillRect(x + KW - 2, KT - 0.6, 2, 10.6);
      if (i > 0 && hasBlack(i - 1)) g.fillRect(x, KT - 0.6, 2, 10.6);
    }
    // the metronome, a beat to every two notes
    const [mx, my] = METRO;
    g.save();
    g.translate(mx, my - 9);
    g.rotate(0.5 * Math.sin((t * Math.PI) / (STEP * 2)));
    g.strokeStyle = "rgba(48,38,28,.9)";
    g.lineWidth = 1.4;
    g.lineCap = "round";
    seg(g, 0, 0, 0, -30);
    g.stroke();
    g.fillStyle = BRASS;
    g.fillRect(-3.2, -22, 6.4, 5.4);
    g.lineWidth = 0.7;
    g.strokeRect(-3.2, -22, 6.4, 5.4);
    g.restore();
    // the page turns in the rest
    const turn = (c % PHRASE.length) - 17.2;
    const [sx, sy] = STAND;
    if (turn > 0 && turn < 1.6) {
      const ph = Math.PI * (0.5 - 0.5 * Math.cos((turn / 1.6) * Math.PI));
      const ex = Math.cos(ph) * 16.5;
      const lift = Math.sin(ph) * 6;
      g.fillStyle = "#ece3c8";
      g.beginPath();
      g.moveTo(sx, sy - 49);
      g.lineTo(sx + ex, sy - 47.6 - lift);
      g.lineTo(sx + ex * 0.95, sy - 30 - lift);
      g.lineTo(sx, sy - 30.8);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(48,38,28,.8)";
      g.lineWidth = 0.7;
      g.lineJoin = "round";
      g.stroke();
    }
    // lamp light behind the fallboard windows
    [-80, 0, 80].forEach((x, i) =>
      fittings.glowPane(g, s, x - 7, -132, 14, 20, i * 1.9),
    );
  },
};
