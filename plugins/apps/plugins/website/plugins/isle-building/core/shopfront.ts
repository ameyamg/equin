// The website's building on Isle: the shopfront — the island's public face,
// where what it has to show is put in the window. A painted shop: two display
// windows under striped awnings either side of the door, and over them a
// great false-front sign board rising above the roof, the app's own device
// painted in a roundel under its round crest, a banner on the pole above. A
// sign hangs from a bracket at the corner; a poster hoarding stands in the
// yard, the billposter's ladder against it. It is the site on show: a
// carousel of framed pictures turns in the window, every so often a new
// poster comes down over the old one on the hoarding, the hanging sign and
// the banner stir in the wind, the lamps over the sign come on at dusk.

import {
  accent,
  castShadow,
  dark,
  doorArch,
  fittings,
  grain,
  hline,
  ink,
  ladder,
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
  type PaintState,
  type Pt,
} from "@plugins/apps/plugins/isle/plugins/buildings/core";

const {
  TAU,
  INK,
  IRON,
  BRASS,
  BRASS_D,
  GILT,
  clamp01,
  ease,
  disc,
  seg,
  ellShadow,
  bar,
  streaks,
  gust,
  glowPane,
  cloth,
} = fittings;

const GRAIN_BOX: Box = [-150, -300, 210, 50];
const PAPER = "#e6ddc4";
const PAPER_D = "#cfc5a8";
const CREAM = "#ddd3b8";
const TIMBER = "#6b563f";

/** The front wall, and the one vector its right side recedes along (the high 3/4 view). */
const L = -98;
const R = 98;
const SD = 26;
const SY = -oblique.rise(SD);
/** The top of the shop storey (its cornice), the eaves, the ridge. */
const SHOP = -98;
const EAVE = -156;
const PEAK = -208;
/** The sign board: half width, bottom, the y of its shoulders — and of its round crest's centre — the crest's radius. */
const BX = 80;
const BB = -108;
const CY = -190;
const CR = 46;
/** The roundel on it. */
const ROUND = 33;
/** The display windows: x of the left one's left edge, width, bottom, height (the right one mirrors it). */
const WIN = [-86, 56, -20, 60] as const;
/** The carousel in the left window: its axis, the shelf it stands on. */
const TURN = [-58, -25] as const;
/** The hanging sign's pivot, at the end of its bracket. */
const HANG: Pt = [-119, -128];
/** The banner's pole: its foot on the crest, its top. */
const POLE = [CY - CR, -292] as const;
/** The poster hoarding in the yard: x, y, w, h of its board; its two posters (x, y, w, h). */
const HOARD = [130, -98, 66, 66] as const;
const BILLS = [
  [134, -93, 27, 44],
  [165, -93, 27, 44],
] as const;
/** How often a new poster goes up, and how long it takes to come down. */
const POST_EVERY = 21;
const postAt = (t: number): { n: number; u: number } => {
  const n = Math.floor(t / POST_EVERY);
  return { n, u: clamp01((t - n * POST_EVERY - 16) / 4) };
};
/** The muted colours the pictures on show are painted in. */
const TINTS = ["#a8705c", "#6f8f86", "#b09a62", "#7a78a6"] as const;

const inkOf = (s: PaintState): string => mix(accent(s.hue), "#3a3630", 0.45);

/** The sign board's outline: a panel under a round crest. */
function boardPath(g: Ctx2D, grow: number): void {
  g.beginPath();
  g.moveTo(-BX - grow, BB + grow);
  g.lineTo(-BX - grow, CY - grow);
  g.lineTo(-CR - grow, CY - grow);
  g.arc(0, CY, CR + grow, Math.PI, TAU);
  g.lineTo(BX + grow, CY - grow);
  g.lineTo(BX + grow, BB + grow);
  g.closePath();
}

/** A small landscape cut in (x, y, w, h): sky, two hills. */
function cut(
  g: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tint: string,
): void {
  g.fillStyle = mix(tint, "#d8d0b8", 0.55);
  g.fillRect(x, y, w, h);
  g.fillStyle = tint;
  g.beginPath();
  g.moveTo(x, y + h);
  g.lineTo(x + w * 0.35, y + h * 0.35);
  g.lineTo(x + w * 0.62, y + h * 0.7);
  g.lineTo(x + w * 0.82, y + h * 0.45);
  g.lineTo(x + w, y + h * 0.75);
  g.lineTo(x + w, y + h);
  g.closePath();
  g.fill();
}

/** One poster, filling (x, y, w, h): a head in the app's ink, a picture, lines of matter. */
function poster(
  g: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  k: number,
  inkCol: string,
): void {
  g.fillStyle = k % 2 ? "#e3d9be" : PAPER;
  g.fillRect(x, y, w, h);
  const tint = TINTS[k % TINTS.length]!;
  g.fillStyle = k % 3 === 1 ? tint : inkCol;
  g.fillRect(x + 2, y + 2, w - 4, 6);
  g.fillStyle = "#eee6cf";
  g.fillRect(x + 4, y + 4.2, (w - 8) * (k % 2 ? 0.7 : 0.5), 1.6);
  const ph = k % 3 === 0 ? 16 : 12;
  cut(g, x + 2, y + 10, w - 4, ph, tint);
  g.strokeStyle = "rgba(44,36,28,.55)";
  g.lineWidth = 0.6;
  g.strokeRect(x + 2, y + 10, w - 4, ph);
  g.fillStyle = "rgba(44,36,28,.85)";
  g.fillRect(x + 2, y + 12.5 + ph, (w - 4) * (k % 2 ? 0.8 : 0.62), 2.2);
  g.fillStyle = "rgba(52,44,34,.5)";
  for (let ly = y + 17.5 + ph, i = 0; ly < y + h - 2; ly += 2.5, i++)
    g.fillRect(x + 2, ly, (w - 4) * (((i + k) * 7) % 10 > 7 ? 0.55 : 1), 0.9);
}

/** A framed picture `w` wide (squeezed as it turns) and 17 tall, its bottom middle at (x, y). */
function framed(
  g: Ctx2D,
  x: number,
  y: number,
  w: number,
  k: number,
  shade: number,
): void {
  g.fillStyle = BRASS_D;
  g.fillRect(x - w / 2 - 1.2, y - 18.2, w + 2.4, 19.4);
  g.fillStyle = PAPER;
  g.fillRect(x - w / 2, y - 17, w, 17);
  if (w > 4) {
    cut(g, x - w / 2 + 1, y - 16, w - 2, 9, TINTS[k % TINTS.length]!);
    g.fillStyle = "rgba(52,44,34,.55)";
    g.fillRect(x - w / 2 + 1, y - 5.4, (w - 2) * 0.8, 1);
    g.fillRect(x - w / 2 + 1, y - 3, (w - 2) * 0.55, 1);
  }
  if (shade > 0) {
    g.fillStyle = `rgba(24,20,16,${shade})`;
    g.fillRect(x - w / 2 - 1.2, y - 18.2, w + 2.4, 19.4);
  }
  g.strokeStyle = INK;
  g.lineWidth = 0.7;
  g.strokeRect(x - w / 2 - 1.2, y - 18.2, w + 2.4, 19.4);
}

/** A display window's glazing bars and frame over whatever stands in it. */
function glazingBars(g: Ctx2D, x: number): void {
  const [, w, b, h] = WIN;
  g.strokeStyle = "#4a3f33";
  g.lineWidth = 1.6;
  for (const u of [1 / 3, 2 / 3]) {
    seg(g, x + w * u, b - h, x + w * u, b);
    g.stroke();
  }
  g.lineWidth = 2.4;
  g.strokeRect(x, b - h, w, h);
  g.strokeStyle = INK;
  g.lineWidth = 0.9;
  g.strokeRect(x - 1.4, b - h - 1.4, w + 2.8, h + 2.8);
}

/** A striped awning over the window whose left edge is `x`. */
function awning(g: Ctx2D, x: number, r: () => number, col: string): void {
  const [, w] = WIN;
  const x0 = x - 4;
  const x1 = x + w + 4;
  const yt = SHOP + 14;
  const yb = SHOP + 29;
  const n = 8;
  g.fillStyle = "rgba(24,20,14,.28)";
  g.fillRect(x0 - 1, yb + 4, x1 - x0 + 4, 7);
  for (let i = 0; i < n; i++) {
    const a0 = x0 + ((x1 - x0) * i) / n;
    const a1 = x0 + ((x1 - x0) * (i + 1)) / n;
    const b0 = x0 - 4 + ((x1 - x0 + 8) * i) / n;
    const b1 = x0 - 4 + ((x1 - x0 + 8) * (i + 1)) / n;
    const c = i % 2 ? CREAM : col;
    poly(g, [
      [a0, yt],
      [a1, yt],
      [b1, yb],
      [b0, yb],
    ]);
    g.fillStyle = c;
    g.fill();
    // the valance, a scallop under each stripe
    g.beginPath();
    g.moveTo(b0, yb);
    g.lineTo(b1, yb);
    g.lineTo(b1, yb + 4);
    g.quadraticCurveTo((b0 + b1) / 2, yb + 9, b0, yb + 4);
    g.closePath();
    g.fillStyle = dark(c, 0.14);
    g.fill();
    ink(g, 0.7, 0.6);
    g.stroke();
  }
  g.save();
  poly(g, [
    [x0, yt],
    [x1, yt],
    [x1 + 4, yb],
    [x0 - 4, yb],
  ]);
  g.clip();
  streaks(g, r, [x0 - 4, yt, x1 + 4, yb], 7, "60,52,40", 0.12, 14);
  const sh = g.createLinearGradient(0, yt, 0, yb);
  sh.addColorStop(0, "rgba(24,20,14,.26)");
  sh.addColorStop(0.5, "rgba(24,20,14,0)");
  sh.addColorStop(1, "rgba(255,250,235,.12)");
  g.fillStyle = sh;
  g.fillRect(x0 - 4, yt, x1 - x0 + 8, yb - yt);
  g.restore();
  poly(g, [
    [x0, yt],
    [x1, yt],
    [x1 + 4, yb],
    [x0 - 4, yb],
  ]);
  ink(g, 1.2);
  g.stroke();
}

/** A gooseneck lamp over the sign, its foot at (x, CY), reaching `dir` (1: right). */
function gooseneck(g: Ctx2D, x: number, dir: number, lit: boolean): void {
  g.beginPath();
  g.moveTo(x, CY);
  g.lineTo(x, CY - 12);
  g.quadraticCurveTo(x, CY - 21, x + dir * 7, CY - 20);
  g.quadraticCurveTo(x + dir * 12, CY - 19, x + dir * 12, CY - 13);
  bar(g, 1.6, IRON, null);
  poly(g, [
    [x + dir * 12 - 5, CY - 9],
    [x + dir * 12 + 5, CY - 9],
    [x + dir * 12 + 2.4, CY - 14],
    [x + dir * 12 - 2.4, CY - 14],
  ]);
  g.fillStyle = "#4a5a52";
  g.fill();
  ink(g, 0.9);
  g.stroke();
  g.fillStyle = lit ? "#ffe2a0" : "#cfc6ac";
  g.fillRect(x + dir * 12 - 3, CY - 9, 6, 1.8);
}

export const shopfront: BuildingSpec = {
  door: { kind: "leaf", w: 34, h: 58, arch: true },
  footprint: {
    w: 200,
    depth: 72,
    ground: [-151, -112, 221, 39],
    upper: [-141, -309, 157, -112],
  },
  setting: ["square", "lane", "harbour"],
  signX: -156,
  lights: [
    [-58, -46, 22],
    [58, -46, 22],
    [0, -30, 16],
    [-34, CY, 24],
    [34, CY, 24],
  ],
  chimney: { x: 108.5, y: -228, phase: 4.2, puffs: 5 },
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const A = accent(s.hue);
    const PAINT = mix(A, "#8a8472", 0.78);
    const DEEP = mix(A, "#4a4640", 0.42);
    const STRIPE = mix(A, "#8a8272", 0.3);
    const inkCol = inkOf(s);
    castShadow(
      g,
      [
        [L + 6, 4],
        [R, 4],
        [R + 78, 30],
        [R + 92, -22],
        [R + SD, SY],
      ],
      0.3,
    );
    // the roof's right slope, slated, and the brick stack through it
    const slope = oblique.extrude([R + 5, EAVE + 3], [0, PEAK], SD);
    oblique.fill(g, slope, (pts) =>
      polyKit.shingles(g, pts, r, polyKit.SLATE, 6.5, 10),
    );
    oblique.inkFace(g, slope, 1.3);
    // (the stack: a brick box with its right side receding, under a capping seen from above)
    oblique.solid(
      g,
      { x0: 99, x1: 113, yb: -178, yt: -222, d: 9 },
      {
        side: (d, yt, yb) =>
          stones(g, 0, yt, d, yb, r, {
            rowH: 5,
            blockW: 6,
            base: "#8a6858",
            mortar: "#5a463c",
            outline: false,
          }),
        front: () =>
          stones(g, 99, -222, 113, -178, r, {
            rowH: 5,
            blockW: 8,
            base: "#a07a66",
            mortar: "#6a5448",
            outline: false,
          }),
        ink: 1,
      },
    );
    oblique.solid(
      g,
      { x0: 97, x1: 115, yb: -221, yt: -226, d: 11 },
      {
        side: (d, yt, yb) => {
          g.fillStyle = "#463a32";
          g.fillRect(0, yt, d, yb - yt);
        },
        top: (x0, x1, d) => {
          g.fillStyle = "#6c5c50";
          g.fillRect(x0, 0, x1 - x0, d);
          g.fillStyle = "#2a2420";
          g.fillRect(x0 + 5, 3, x1 - x0 - 10, d - 6);
        },
        front: () => {
          g.fillStyle = "#5a4a40";
          g.fillRect(97, -226, 18, 5);
        },
        shade: 0,
        ink: 1,
      },
    );
    // the side, receding: plaster over the painted shop storey, a window, in shade
    const side = oblique.sideFace(R, 0, EAVE, SD);
    oblique.onSide(g, R, () => {
      g.save();
      g.beginPath();
      g.rect(0, EAVE, SD, -EAVE);
      g.clip();
      wash(
        g,
        () => {
          g.beginPath();
          g.rect(0, EAVE, SD, -EAVE);
        },
        [0, EAVE, SD, 0],
        "#c9c0a8",
        r,
        { blob: 7, var: 18, shade: false, outline: false },
      );
      planks(g, 0, SHOP, SD, -12, r, { base: PAINT, pw: 9 });
      stones(g, 0, -12, SD, 0, r, { rowH: 6, outline: false });
      g.fillStyle = TIMBER;
      g.fillRect(0, SHOP - 3, SD, 5);
      windowRect(g, 7, -110, 12, 26, r, {
        lit,
        frame: "#4a3a2c",
        sill: "#b3ab98",
      });
      g.restore();
    });
    oblique.shadeFace(g, side, 0.32);
    oblique.fill(g, side, (pts) => polyKit.hatch(g, pts, r, 3.5, 0.15));
    oblique.inkFace(g, side, 1.3);
    // the gable front: lime plaster, its bargeboards
    const front: Pt[] = [
      [L, SHOP],
      [L, EAVE],
      [0, PEAK],
      [R, EAVE],
      [R, SHOP],
    ];
    wash(g, () => poly(g, front), [L, PEAK, R, SHOP], "#d6cdb4", r, {
      blob: 9,
      var: 18,
      shadeA: 0.16,
      lw: 1.3,
    });
    for (const k of [-1, 1]) {
      seg(g, k * (R + 5), EAVE + 3, 0, PEAK);
      bar(g, 3.4, TIMBER, "rgba(255,244,214,.18)");
    }
    // the shop storey: painted panelling on a stone plinth
    planks(g, L, SHOP, R, -12, r, { base: PAINT, pw: 9 });
    g.save();
    g.beginPath();
    g.rect(L, SHOP, R - L, -SHOP - 12);
    g.clip();
    streaks(g, r, [L, SHOP, R, -12], 12, "40,36,30", 0.12, 46);
    streaks(g, r, [L, SHOP, R, -12], 6, "226,226,208", 0.08, 30);
    g.restore();
    stones(g, L - 2, -12, R + 2, 0, r, { rowH: 6, blockW: 15 });
    ink(g, 1.3);
    g.strokeRect(L, SHOP, R - L, -SHOP);
    polyKit.ao(g, L, R, 0);
    // pilasters at the corners and by the door
    for (const x of [L, -29, 21, R - 8]) {
      wash(
        g,
        () => {
          g.beginPath();
          g.rect(x, SHOP + 14, 8, -SHOP - 26);
        },
        [x, SHOP + 14, x + 8, -12],
        dark(PAINT, 0.12),
        r,
        { blob: 4, var: 14, shadeA: 0.2, lw: 1 },
      );
      g.fillStyle = dark(PAINT, 0.3);
      g.fillRect(x - 1.5, -18, 11, 6);
      g.fillRect(x - 1.5, SHOP + 14, 11, 4);
      ink(g, 0.8, 0.7);
      g.strokeRect(x - 1.5, -18, 11, 6);
      g.strokeRect(x - 1.5, SHOP + 14, 11, 4);
    }
    // the fascia and its cornice
    wash(
      g,
      () => {
        g.beginPath();
        g.rect(L - 2, SHOP, R - L + 4, 14);
      },
      [L - 2, SHOP, R + 2, SHOP + 14],
      DEEP,
      r,
      { blob: 6, var: 14, shadeA: 0.2, lw: 1.2 },
    );
    g.strokeStyle = GILT;
    g.lineWidth = 1;
    g.strokeRect(L + 3, SHOP + 3.5, R - L - 6, 7);
    for (const x of [-60, -36, 36, 60]) {
      g.fillStyle = GILT;
      g.beginPath();
      g.moveTo(x, SHOP + 4.6);
      g.lineTo(x + 2.6, SHOP + 7);
      g.lineTo(x, SHOP + 9.4);
      g.lineTo(x - 2.6, SHOP + 7);
      g.closePath();
      g.fill();
    }
    wash(
      g,
      () => {
        g.beginPath();
        g.rect(L - 6, SHOP - 5, R - L + 12, 6);
      },
      [L - 6, SHOP - 5, R + 6, SHOP + 1],
      "#c9c1ad",
      r,
      { blob: 4, var: 12, shadeA: 0.24, lw: 1.2 },
    );
    // the display windows: what is on show in the right one (the left one's carousel turns: see animate)
    const [wx, ww, wb, wh] = WIN;
    for (const x of [wx, -wx - ww]) {
      const gi = g.createLinearGradient(0, wb - wh, 0, wb);
      if (lit) {
        gi.addColorStop(0, "#e9b868");
        gi.addColorStop(1, "#f6d894");
      } else {
        gi.addColorStop(0, "#565e5c");
        gi.addColorStop(1, "#8b8876");
      }
      g.fillStyle = gi;
      g.fillRect(x, wb - wh, ww, wh);
      g.fillStyle = lit ? "#b98a4e" : "#6e5a42";
      g.fillRect(x, wb - 6, ww, 6);
      g.fillStyle = "rgba(24,20,14,.3)";
      g.fillRect(x, wb - 7.4, ww, 1.6);
      // the stall riser under it
      wash(
        g,
        () => {
          g.beginPath();
          g.rect(x + 3, wb + 2.5, ww - 6, 4.6);
        },
        [x + 3, wb + 2.5, x + ww - 3, wb + 7.1],
        dark(PAINT, 0.2),
        r,
        { blob: 3, var: 12, shade: false, lw: 0.8 },
      );
    }
    const rx = -wx - ww;
    [
      [rx + 11, 0],
      [rx + 28, 2],
      [rx + 45, 1],
    ].forEach(([x, k], i) => {
      g.strokeStyle = "#5a4632";
      g.lineWidth = 1.4;
      seg(g, x! - 4, wb - 6, x!, wb - 16);
      g.stroke();
      seg(g, x! + 4, wb - 6, x!, wb - 16);
      g.stroke();
      framed(g, x!, wb - 11 - (i % 2) * 4, 13, k! + 1, 0);
    });
    // a globe on a brass stand, at the back of the right window
    seg(g, rx + 28, wb - 34, rx + 28, wb - 42);
    bar(g, 1.4, BRASS, null);
    disc(g, rx + 28, wb - 46, 7);
    g.fillStyle = mix(A, "#8c9a94", 0.5);
    g.fill();
    ink(g, 0.9);
    g.stroke();
    g.strokeStyle = "rgba(40,34,28,.5)";
    g.lineWidth = 0.6;
    g.beginPath();
    g.ellipse(rx + 28, wb - 46, 3, 7, 0, 0, TAU);
    g.stroke();
    seg(g, rx + 21, wb - 46, rx + 35, wb - 46);
    g.stroke();
    glazingBars(g, rx);
    // the door, its step
    doorArch(g, 0, 0, 34, 58, r, { col: mix(A, "#5e4a36", 0.35) });
    ink(g, 0.9, 0.7);
    hline(g, 0, -56, 0, 0, r, 0.2);
    steps(g, 0, 2, 40, 1, r);
    // the awnings
    awning(g, wx, r, STRIPE);
    awning(g, rx, r, STRIPE);
    // the sign board, standing proud of the gable: deep paint in a timber frame, a gilt line
    g.fillStyle = "rgba(24,20,14,.3)";
    g.fillRect(-BX + 3, BB, 2 * BX + 3, 6);
    boardPath(g, 4);
    g.fillStyle = TIMBER;
    g.fill();
    ink(g, 1.4);
    g.stroke();
    wash(g, () => boardPath(g, 0), [-BX, CY - CR, BX, BB], DEEP, r, {
      blob: 10,
      var: 16,
      shadeA: 0.24,
      lw: 1.1,
    });
    g.save();
    boardPath(g, 0);
    g.clip();
    streaks(g, r, [-BX, CY - CR, BX, BB], 14, "30,28,24", 0.12, 50);
    streaks(g, r, [-BX, CY - CR, BX, BB], 8, "226,226,208", 0.07, 40);
    g.restore();
    boardPath(g, -4);
    g.strokeStyle = GILT;
    g.lineWidth = 1.2;
    g.stroke();
    // the roundel: the app's device, sun rays behind it
    g.save();
    boardPath(g, -5);
    g.clip();
    g.strokeStyle = "rgba(176,154,98,.55)";
    g.lineWidth = 1.5;
    for (let a = Math.PI + 0.18; a < TAU - 0.1; a += 0.262) {
      seg(
        g,
        Math.cos(a) * (ROUND + 4),
        CY + Math.sin(a) * (ROUND + 4),
        Math.cos(a) * (CR + 2),
        CY + Math.sin(a) * (CR + 2),
      );
      g.stroke();
    }
    g.restore();
    wash(
      g,
      () => disc(g, 0, CY, ROUND),
      [-ROUND, CY - ROUND, ROUND, CY + ROUND],
      CREAM,
      r,
      { blob: 7, var: 14, shadeA: 0.18, lw: 1.2 },
    );
    disc(g, 0, CY, ROUND - 3.4);
    g.strokeStyle = GILT;
    g.lineWidth = 1.6;
    g.stroke();
    g.fillStyle = inkCol;
    s.glyph(g, 0, CY + 1, 50);
    // the ribbon under it, and its ruled lines
    poly(g, [
      [-64, -146],
      [64, -146],
      [57, -134.5],
      [64, -123],
      [-64, -123],
      [-57, -134.5],
    ]);
    g.fillStyle = CREAM;
    g.fill();
    ink(g, 1);
    g.stroke();
    g.fillStyle = inkCol;
    for (const [x, w] of [
      [-46, 30],
      [-11, 18],
      [12, 34],
    ] as const)
      g.fillRect(x, -139, w, 5);
    g.fillStyle = "rgba(52,44,34,.5)";
    g.fillRect(-36, -130.5, 72, 1.6);
    for (const x of [-70, 70]) {
      g.fillStyle = GILT;
      disc(g, x, -115, 2);
      g.fill();
    }
    // the lamps over the sign, the banner's pole
    gooseneck(g, -73, 1, lit);
    gooseneck(g, 73, -1, lit);
    seg(g, 0, POLE[0] + 2, 0, POLE[1]);
    bar(g, 2.4, "#7d6648", "rgba(255,244,214,.25)");
    disc(g, 0, POLE[1] - 2, 2.8);
    g.fillStyle = BRASS;
    g.fill();
    ink(g, 0.9);
    g.stroke();
    // the hanging sign's bracket (the sign swings: see animate)
    seg(g, L, HANG[1] - 4, HANG[0] - 10, HANG[1] - 4);
    bar(g, 2.4, IRON, "rgba(220,220,210,.25)");
    seg(g, L, HANG[1] + 12, HANG[0], HANG[1] - 4);
    bar(g, 1.5, IRON, null);
    // the poster hoarding in the yard: posts, a boarded panel under a little roof, the left bill, the ladder
    const [hx, hy, hw, hh] = HOARD;
    castShadow(
      g,
      [
        [hx, 12],
        [hx + hw, 12],
        [hx + hw + 16, 20],
        [hx + 16, 20],
      ],
      0.26,
    );
    for (const x of [hx + 4, hx + hw - 4]) {
      seg(g, x, 12, x, hy + 4);
      bar(g, 3.6, "#7d6648", "rgba(255,244,214,.2)");
    }
    planks(g, hx, hy, hx + hw, hy + hh, r, { base: "#85745a", pw: 8 });
    ink(g, 1.3);
    g.strokeRect(hx, hy, hw, hh);
    poly(g, [
      [hx - 5, hy],
      [hx + hw + 5, hy],
      [hx + hw + 1, hy - 7],
      [hx - 1, hy - 7],
    ]);
    g.fillStyle = "#5c5348";
    g.fill();
    ink(g, 1.1);
    g.stroke();
    // scraps of older bills under the two posted ones
    for (const [x, y, w, h] of [
      [hx + 3, hy + 46, 22, 16],
      [hx + 30, hy + 49, 30, 13],
    ] as const) {
      g.fillStyle = PAPER_D;
      g.fillRect(x, y, w, h);
      g.fillStyle = "rgba(52,44,34,.4)";
      for (let ly = y + 3; ly < y + h - 1; ly += 3)
        g.fillRect(x + 2, ly, w - 4, 0.9);
      ink(g, 0.6, 0.5);
      g.strokeRect(x, y, w, h);
    }
    const [b0] = BILLS;
    poster(g, b0[0], b0[1], b0[2], b0[3], 2, inkCol);
    if (lit) {
      g.fillStyle = "rgba(20,24,44,.22)";
      g.fillRect(b0[0], b0[1], b0[2], b0[3]);
    }
    ink(g, 0.9);
    g.strokeRect(b0[0], b0[1], b0[2], b0[3]);
    ladder(g, hx + hw - 2, 16, 104);
    // the paste bucket and its brush
    g.fillStyle = "#8c8f92";
    poly(g, [
      [hx + 22, 6],
      [hx + 34, 6],
      [hx + 32.5, 17],
      [hx + 23.5, 17],
    ]);
    g.fill();
    ink(g, 0.9);
    g.stroke();
    g.fillStyle = PAPER;
    g.fillRect(hx + 23, 6, 10, 2);
    seg(g, hx + 31, 8, hx + 43, -22);
    bar(g, 1.6, "#8a6e40", null);
    g.fillStyle = "#4a4038";
    g.fillRect(hx + 40, -29, 7, 7);
    // a sandwich board by the door
    for (const k of [1, 0]) {
      poly(g, [
        [-124 + k * 5, 20 - k * 3],
        [-106 + k * 5, 20 - k * 3],
        [-109 + k * 2, -8],
        [-121 + k * 2, -8],
      ]);
      g.fillStyle = k ? "#5c4a36" : CREAM;
      g.fill();
      ink(g, 1);
      g.stroke();
    }
    g.fillStyle = inkCol;
    s.glyph(g, -115, 2, 11);
    g.fillRect(-120, 10, 10, 1.4);
    g.fillRect(-119, 13.4, 8, 1.2);
    ellShadow(g, -110, 21, 13, 3, 0.24);
    // what grows about
    moss(g, L, R, 1, r, 14);
    tufts(g, L - 8, -24, 4, r, 14);
    tufts(g, 24, R + 20, 4, r, 14);
    tufts(g, hx - 4, hx + hw + 8, 15, r, 10);
    for (const [x, y, z, k] of [
      [-136, -2, 10, 0],
      [118, -6, 9, 1],
      [204, 6, 8, 2],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    const lit = s.night || s.dusk;
    const A = accent(s.hue);
    const inkCol = inkOf(s);
    // the carousel in the left window: four framed pictures going round, the far ones in shade
    {
      const [cx, cy] = TURN;
      const a0 = t * 0.32;
      g.fillStyle = BRASS_D;
      g.fillRect(cx - 1.2, cy - 30, 2.4, 30);
      const cards = [0, 1, 2, 3]
        .map((i) => {
          const a = a0 + (i * TAU) / 4;
          return { i, x: Math.cos(a), z: Math.sin(a) };
        })
        .sort((p, q) => p.z - q.z);
      for (const c of cards)
        framed(
          g,
          cx + c.x * 17,
          cy - 6 + c.z * 2.4,
          Math.max(1.6, 14 * Math.abs(c.z)),
          c.i,
          c.z < 0 ? 0.42 : 0.12 * (1 - c.z),
        );
      g.fillStyle = BRASS;
      g.beginPath();
      g.ellipse(cx, cy - 1.4, 21, 3.4, 0, 0, TAU);
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 0.8;
      g.stroke();
      disc(g, cx, cy - 31, 2.4);
      g.fillStyle = BRASS;
      g.fill();
      g.stroke();
      glowPane(g, s, WIN[0], WIN[2] - WIN[3], WIN[1], WIN[3], 0.8);
      glazingBars(g, WIN[0]);
      glowPane(g, s, -WIN[0] - WIN[1], WIN[2] - WIN[3], WIN[1], WIN[3], 3.3);
    }
    // the hoarding: the posted bill, and every so often a new one brought down over it
    {
      const [, b] = BILLS;
      const [x, y, w, h] = b;
      const { n, u } = postAt(t);
      poster(g, x, y, w, h, n, inkCol);
      if (u > 0) {
        const down = ease(u) * h;
        g.save();
        g.beginPath();
        g.rect(x, y, w, down);
        g.clip();
        poster(g, x, y, w, h, n + 1, inkCol);
        g.restore();
        if (u < 1) {
          g.fillStyle = "rgba(24,20,14,.3)";
          g.fillRect(x, y + down + 2.2, w, 2);
          g.fillStyle = PAPER_D;
          g.fillRect(x - 1.2, y + down - 2.2, w + 2.4, 4.4);
          g.fillStyle = "rgba(255,250,235,.35)";
          g.fillRect(x - 1.2, y + down - 2.2, w + 2.4, 1.2);
          g.strokeStyle = INK;
          g.lineWidth = 0.8;
          g.strokeRect(x - 1.2, y + down - 2.2, w + 2.4, 4.4);
        }
      }
      if (s.night) {
        g.fillStyle = "rgba(20,24,44,.22)";
        g.fillRect(x, y, w, h);
      }
      g.strokeStyle = INK;
      g.lineWidth = 0.9;
      g.strokeRect(x, y, w, h);
      // the left bill's loose corner lifts in a gust
      const [a] = BILLS;
      const k = Math.max(0, gust(t, 2.3)) * (0.6 + 0.4 * Math.sin(t * 3.1));
      const cxn = a[0] + a[2];
      const cyn = a[1] + a[3];
      g.fillStyle = PAPER_D;
      g.beginPath();
      g.moveTo(cxn - 8, cyn);
      g.lineTo(cxn, cyn - 8);
      g.lineTo(cxn - 2 - 4 * k, cyn - 2 - 4 * k);
      g.closePath();
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 0.7;
      g.stroke();
    }
    // the hanging sign, swinging on its hooks
    {
      const sw =
        0.11 * Math.sin(t * 1.3) * (0.35 + Math.max(0, gust(t, 1))) +
        0.03 * Math.sin(t * 2.9);
      g.save();
      g.translate(HANG[0], HANG[1] - 4);
      g.rotate(sw);
      g.strokeStyle = INK;
      g.lineWidth = 1;
      seg(g, -7, 0, -7, 6);
      g.stroke();
      seg(g, 7, 0, 7, 6);
      g.stroke();
      g.fillStyle = TIMBER;
      g.beginPath();
      g.roundRect(-13, 6, 26, 28, 3);
      g.fill();
      g.lineWidth = 1.1;
      g.stroke();
      g.fillStyle = CREAM;
      disc(g, 0, 20, 10);
      g.fill();
      g.lineWidth = 0.8;
      g.stroke();
      g.fillStyle = inkCol;
      s.glyph(g, 0, 20.5, 15);
      g.restore();
    }
    // the banner on its pole
    cloth(g, 1.5, POLE[1] + 3, 36, 19, t, 0.6, mix(A, "#6a6460", 0.22));
    // the lamps over the sign, at dusk and night
    if (lit) {
      g.save();
      g.globalCompositeOperation = "lighter";
      for (const [x, ph] of [
        [-61, 0.4],
        [61, 2.9],
      ] as const) {
        const f =
          0.8 + 0.12 * Math.sin(t * 1.7 + ph) + 0.08 * Math.sin(t * 6.1 + ph);
        const lg = g.createRadialGradient(x, CY - 8, 2, x, CY + 14, 58);
        lg.addColorStop(0, `rgba(255,220,150,${0.5 * f})`);
        lg.addColorStop(1, "rgba(255,200,110,0)");
        g.fillStyle = lg;
        g.fillRect(x - 60, CY - 46, 120, 120);
      }
      g.restore();
    }
  },
};
