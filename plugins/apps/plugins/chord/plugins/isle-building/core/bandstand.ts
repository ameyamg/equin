// Chord's building on Isle: the bandstand — a Belle-Époque park music kiosk.
// Eight slender cast-iron columns with scrolled brackets stand on a stone
// plinth and carry a swooping bell-cast copper roof gone green, a glazed
// cupola and a gilt lyre vane; a fretwork frieze cut with notes runs under the
// eave, a boarded acoustic shell closes the back, and the stage is set to
// play: an upright piano, a sousaphone, a bass viol, a guitar, an accordion,
// chairs and music stands. A four-chord progression plays: the chord's strings
// ring on the guitar and its root on the bass, the accordion's bellows open,
// three or four brass chimes swing in the frieze, one of the four coloured
// lanterns under the eave lights for the chord, the conductor's page turns
// when it comes round again, a sparrow hops along the balustrade at every
// strum, and a campfire with log seats burns beside it to play by.

import {
  accent,
  bbox,
  dark,
  fittings,
  grain,
  ink,
  ivy,
  jit,
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
  wash,
  type Box,
  type BuildingSpec,
  type Ctx2D,
  type Light,
  type PaintState,
  type Pt,
} from "@plugins/apps/plugins/isle/plugins/buildings/core";

const {
  TAU,
  INK,
  BRASS,
  BRASS_D,
  BRASS_L,
  IRON,
  VERDIGRIS,
  disc,
  seg,
  bar,
  streaks,
  ellShadow,
  gust,
} = fittings;

const GRAIN_BOX: Box = [-190, -300, 190, 60];
/** Painted cast iron, and the cream paint of the woodwork. */
const IRON_GREEN = "#3b4741";
const CREAM = "#d2c8ae";

// An eight-sided stand in the shared high view: every level is an octagon
// (radii rx, ry ≈ rx / 3) with a flat side to the front.
/** The floor's radii and centre, the columns' height, the plinth's. */
const RX = 104;
const RY = 34;
const CY = -53;
const HC = 112;
const PLINTH = 20;
/** The eave's radii and centre, the roof's rise, the samples along a hip. */
const RXE = 122;
const RYE = 40;
const CYE = CY - HC;
const HR = 62;
const NJ = 9;

const angle = (k: number): number => ((k + 0.5) * Math.PI) / 4;
const lerp = (a: Pt, b: Pt, u: number): Pt => [
  a[0] + (b[0] - a[0]) * u,
  a[1] + (b[1] - a[1]) * u,
];
/** Floor corner `k` (mod 8): a column's foot. Corner 1 → 2 is the front side. */
const F = (k: number): Pt => [
  Math.cos(angle(k & 7)) * RX,
  CY + Math.sin(angle(k & 7)) * RY,
];

/** The roof's radius at height `u` (0 the eave … 1 the cupola): wide and nearly flat at the eave, steep at the top. */
const roofRadius = (u: number): number => 0.17 + 0.83 * Math.pow(1 - u, 1.9);
/** Hip `k` of the roof, from the eave up. */
const hip = (k: number): Pt[] =>
  Array.from({ length: NJ + 1 }, (_, j): Pt => {
    const u = j / NJ;
    const q = roofRadius(u);
    return [
      Math.cos(angle(k)) * RXE * q,
      CYE - u * HR + Math.sin(angle(k)) * RYE * q,
    ];
  });
const HIPS: readonly (readonly Pt[])[] = [0, 1, 2, 3, 4, 5, 6, 7].map(hip);
const hipOf = (k: number): readonly Pt[] => HIPS[k & 7] ?? [];
/** How each facet (corner k → k + 1) takes the light from the upper left. */
const FACET_LIGHT = [-0.16, 0, 0.14, 0.2, 0.02, -0.12, -0.24, -0.28] as const;
/** The cupola's foot. */
const CT = CYE - HR;
const RC = RXE * 0.17;
const RCY = RYE * 0.17;

interface Chord {
  /** The guitar's strings that sound, bass first. */
  readonly strings: readonly number[];
  /** The chimes that swing. */
  readonly chimes: readonly number[];
}
/** The progression, one chord a bar. */
const CHORDS: readonly Chord[] = [
  { strings: [1, 2, 3, 4], chimes: [3, 5, 7] },
  { strings: [0, 1, 2, 3], chimes: [1, 4, 6, 9] },
  { strings: [2, 3, 4], chimes: [2, 5, 8] },
  { strings: [2, 3, 4, 5], chimes: [0, 4, 7, 10] },
];
const BAR = 3.4;

/** Four coloured lanterns under the front eave, one per chord (null: the app's colour). */
const LAMPS: readonly (string | null)[] = [
  "#b0664c",
  "#c2a04e",
  VERDIGRIS,
  null,
];
const lampAt = (i: number): Pt => {
  const a = angle(3 - i);
  return [Math.cos(a) * RXE * 0.97, CYE + Math.sin(a) * RYE + 9];
};

/** Twelve chimes under the front frieze — three on each slanted side, six across the front: x, y, length. */
const CHIMES: readonly (readonly [number, number, number])[] = Array.from(
  { length: 12 },
  (_, i) => {
    const p =
      i < 3
        ? lerp(F(3), F(2), (i + 0.7) / 3.4)
        : i < 9
          ? lerp(F(2), F(1), (i - 3 + 0.5) / 6)
          : lerp(F(1), F(0), (i - 9 + 0.7) / 3.4);
    return [p[0], p[1] - HC + 15, 8 + ((i * 5) % 4) * 1.6] as const;
  },
);

/** An instrument on its stand: foot x, y, lean, scale. */
type Placed = readonly [number, number, number, number];
const GUITAR: Placed = [-21, -29, -0.1, 0.8];
const BASS: Placed = [33, -31, 0.07, 1];
/** The accordion's chair, the conductor's stand, the fire ring, the sparrow's rail. */
const ACCORDION: Pt = [-66, -48];
const STAND: Pt = [6, -35];
const FIRE: Pt = [-140, 28];
const PERCH: Pt = lerp(F(0), F(1), 0.45);

/** Begins a guitar body's outline, in the instrument's own frame (its foot at the origin). */
function guitarBody(g: Ctx2D): void {
  g.beginPath();
  g.moveTo(0, -5);
  g.bezierCurveTo(9, -5, 14, -10, 14, -18);
  g.bezierCurveTo(14, -25, 9, -27, 9.5, -31);
  g.bezierCurveTo(10.5, -34, 11, -36, 10.5, -39);
  g.bezierCurveTo(10, -44, 5, -45.5, 0, -45.5);
  g.bezierCurveTo(-5, -45.5, -10, -44, -10.5, -39);
  g.bezierCurveTo(-11, -36, -10.5, -34, -9.5, -31);
  g.bezierCurveTo(-9, -27, -14, -25, -14, -18);
  g.bezierCurveTo(-14, -10, -9, -5, 0, -5);
  g.closePath();
}

/** Begins a bass viol body's outline, in the instrument's own frame. */
function bassBody(g: Ctx2D): void {
  g.beginPath();
  g.moveTo(0, -6);
  g.bezierCurveTo(10, -6, 16, -10, 16, -19);
  g.bezierCurveTo(16, -24, 12, -26, 10, -28);
  g.bezierCurveTo(8, -31, 8, -34, 10.5, -36);
  g.bezierCurveTo(13, -39, 12.5, -44, 9, -48);
  g.bezierCurveTo(6, -51, 3.4, -53, 3, -56);
  g.lineTo(-3, -56);
  g.bezierCurveTo(-3.4, -53, -6, -51, -9, -48);
  g.bezierCurveTo(-12.5, -44, -13, -39, -10.5, -36);
  g.bezierCurveTo(-8, -34, -8, -31, -10, -28);
  g.bezierCurveTo(-12, -26, -16, -24, -16, -19);
  g.bezierCurveTo(-16, -10, -10, -6, 0, -6);
  g.closePath();
}

/** A stringed instrument standing on an iron stand: its shadow, stand, ribs and washed front, then `fit` its fittings. */
function viol(
  g: Ctx2D,
  r: () => number,
  [x, y, a, sc]: Placed,
  body: (g: Ctx2D) => void,
  col: string,
  box: Box,
  edge: string,
  fit: () => void,
): void {
  g.fillStyle = "rgba(30,26,20,.3)";
  g.beginPath();
  g.ellipse(x + 4, y + 1, 14 * sc, 3.4, 0, 0, TAU);
  g.fill();
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.scale(sc, sc);
  g.strokeStyle = IRON;
  g.lineWidth = 1.6;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(-9, 1);
  g.lineTo(0, -7);
  g.lineTo(9, 1);
  g.moveTo(0, -7);
  g.lineTo(0, -40);
  g.stroke();
  g.save();
  g.translate(2.6, -1.2);
  body(g);
  g.fillStyle = dark(col, 0.5);
  g.fill();
  ink(g, 1.1);
  g.stroke();
  g.restore();
  wash(g, () => body(g), box, col, r, {
    blob: 4,
    var: 26,
    lw: 1.3,
    shadeA: 0.26,
  });
  body(g);
  g.save();
  g.clip();
  g.strokeStyle = edge;
  g.lineWidth = 2.2;
  g.stroke();
  streaks(g, r, box, 6, "70,44,22", 0.16, 18);
  g.restore();
  body(g);
  ink(g, 1.2);
  g.stroke();
  fit();
  g.restore();
}

/** A bentwood chair, its back to side `k`. */
function chair(g: Ctx2D, x: number, y: number, k: number): void {
  g.strokeStyle = "#4a3a2a";
  g.lineWidth = 1.5;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x - 6, y);
  g.lineTo(x - 6, y - 12);
  g.moveTo(x + 6, y);
  g.lineTo(x + 6, y - 12);
  g.moveTo(x + k * 6, y - 12);
  g.quadraticCurveTo(x + k * 9, y - 22, x + k * 6, y - 30);
  g.stroke();
  g.beginPath();
  g.ellipse(x + k * 6.5, y - 26, 2, 6, 0, 0, TAU);
  g.stroke();
  g.fillStyle = "#8a7253";
  g.beginPath();
  g.ellipse(x, y - 12, 8, 2.8, 0, 0, TAU);
  g.fill();
  ink(g, 0.9);
  g.stroke();
}

/** A music stand with an open score, its foot at (x, y). */
function musicStand(g: Ctx2D, x: number, y: number): void {
  g.strokeStyle = IRON;
  g.lineWidth = 1.4;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - 26);
  g.moveTo(x - 6, y + 2);
  g.lineTo(x, y - 5);
  g.lineTo(x + 6, y + 2);
  g.stroke();
  g.fillStyle = "#4a3c30";
  poly(g, [
    [x - 12, y - 43],
    [x + 12, y - 43],
    [x + 11, y - 25],
    [x - 11, y - 25],
  ]);
  g.fill();
  ink(g, 0.9);
  g.stroke();
  for (const q of [-1, 1]) {
    g.fillStyle = q < 0 ? "#e4dabd" : "#d9cfb0";
    poly(g, [
      [x, y - 42],
      [x + q * 10.4, y - 41.2],
      [x + q * 9.8, y - 27],
      [x, y - 27.6],
    ]);
    g.fill();
    ink(g, 0.6, 0.75);
    g.stroke();
    g.strokeStyle = "rgba(60,50,40,.55)";
    g.lineWidth = 0.5;
    for (let j = 0; j < 4; j++) {
      seg(g, x + q * 1.8, y - 39 + j * 3, x + q * 8.6, y - 38.5 + j * 3);
      g.stroke();
    }
  }
}

/** A cast-iron balustrade from `a` to `b` along the deck's edge: balusters with a ring, a foot rail, an oak hand rail; `far` ones stand across the deck, in the roof's shade. */
function balustrade(g: Ctx2D, a: Pt, b: Pt, far: boolean): void {
  const n = Math.max(4, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8));
  g.strokeStyle = far ? "#2f3a35" : IRON_GREEN;
  g.lineWidth = far ? 1.1 : 1.3;
  for (let k = 1; k < n; k++) {
    const p = lerp(a, b, k / n);
    seg(g, p[0], p[1] - 2, p[0], p[1] - 24);
    g.stroke();
    g.beginPath();
    g.arc(p[0], p[1] - 13, 2.6, 0, TAU);
    g.stroke();
  }
  seg(g, a[0], a[1] - 4, b[0], b[1] - 4);
  bar(g, 1.8, far ? "#2f3a35" : IRON_GREEN, null);
  seg(g, a[0], a[1] - 25, b[0], b[1] - 25);
  bar(
    g,
    far ? 2.6 : 3,
    far ? "#4a3a2a" : "#5a4632",
    far ? null : "rgba(255,240,210,.3)",
  );
}

/** A veil of light or shade over the current path's face. */
function tone(g: Ctx2D, sh: number): void {
  g.fillStyle = sh < 0 ? `rgba(30,26,20,${-sh})` : `rgba(255,250,236,${sh})`;
  g.fill();
}

/** A perched bird at (x, y) facing `dir`, `peck` (0..1) its head down. */
function bird(
  g: Ctx2D,
  x: number,
  y: number,
  dir: number,
  col: string,
  peck: number,
): void {
  g.save();
  g.translate(x, y);
  g.scale(dir * 0.95, 0.95);
  g.rotate(peck * 0.55);
  g.lineJoin = "round";
  g.strokeStyle = INK;
  g.lineWidth = 0.9;
  g.fillStyle = dark(col, 0.25);
  g.beginPath();
  g.moveTo(-3.5, -4.6);
  g.lineTo(-9.5, -2.2);
  g.lineTo(-4, -1.6);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = col;
  g.beginPath();
  g.ellipse(0, -3.4, 5, 3.3, -0.15, 0, TAU);
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(4.2, -6.6, 2.3, 0, TAU);
  g.fill();
  g.stroke();
  g.fillStyle = "#c79a5a";
  g.fillRect(6.2, -7, 2.2, 1.1);
  g.fillStyle = "rgba(255,250,235,.3)";
  g.beginPath();
  g.ellipse(-0.5, -4.2, 3, 1.4, -0.2, 0, TAU);
  g.fill();
  g.restore();
}

/** An instrument's strings, in its frame: string `j` runs (x0(j), y0) → (x1(j), y1), ringing by `amp(j)`. */
function strings(
  g: Ctx2D,
  t: number,
  [x, y, a, sc]: Placed,
  n: number,
  x0: (j: number) => number,
  x1: (j: number) => number,
  y0: number,
  y1: number,
  amp: (j: number) => number,
  col: (j: number) => string,
): void {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.scale(sc, sc);
  g.lineCap = "round";
  const my = (y0 + y1) / 2;
  for (let j = 0; j < n; j++) {
    const am = amp(j);
    const xa = x0(j);
    const xb = x1(j);
    const mx = (xa + xb) / 2;
    const w = am * Math.sin(t * 38 + j * 2);
    if (am > 0.15) {
      g.fillStyle = `rgba(252,244,214,${Math.min(0.55, 0.3 * am)})`;
      g.beginPath();
      g.moveTo(xa, y0);
      g.quadraticCurveTo(mx - am * 1.8, my, xb, y1);
      g.quadraticCurveTo(mx + am * 1.8, my, xa, y0);
      g.fill();
    }
    g.beginPath();
    g.moveTo(xa, y0);
    g.quadraticCurveTo(mx + w * 1.8, my, xb, y1);
    g.strokeStyle = "rgba(40,30,22,.5)";
    g.lineWidth = 1.3;
    g.stroke();
    g.strokeStyle = col(j);
    g.lineWidth = 0.7;
    g.stroke();
  }
  g.restore();
}

/** The stones of the fire ring: how many, where stone `k` lies, and whether it is on the near side. */
const RING = 11;
const ringAngle = (k: number): number => (k * TAU) / RING + 0.2;
const ringNear = (k: number): boolean => Math.sin(ringAngle(k)) > 0.2;
const RING_TONE = ["#9a9484", "#a8a292", "#8c8676", "#b0aa98", "#938d7c"];
/** Stone `k` of the fire ring (the same stone every frame: no random stream). */
function ringStone(g: Ctx2D, k: number): void {
  const a = ringAngle(k);
  g.fillStyle = RING_TONE[(k * 3) % RING_TONE.length] ?? "#9a9484";
  g.beginPath();
  g.ellipse(
    FIRE[0] + Math.cos(a) * 14,
    FIRE[1] + Math.sin(a) * 5.6,
    3.7 + ((k * 7) % 5) * 0.2,
    2.7 + ((k * 3) % 4) * 0.15,
    0,
    0,
    TAU,
  );
  g.fill();
  g.strokeStyle = "rgba(48,38,28,.7)";
  g.lineWidth = 0.8;
  g.stroke();
}

/**
 * The campfire in its ring: three flames rising from among the logs — each
 * foot rounded and sunk in the embers, the near log and the near stones of
 * the ring laid over it — a little smoke, its glow.
 */
function campfire(g: Ctx2D, s: PaintState): void {
  const t = s.t;
  const [fx, fy] = FIRE;
  const big = s.night ? 1.25 : s.dusk ? 1.1 : 0.85;
  const wind = gust(t, 1);
  [
    [-4, 0.8, 0],
    [3.5, 0.9, 2.1],
    [0, 1.25, 4.2],
  ].forEach(([dx = 0, hk = 1, ph = 0], i) => {
    const fl =
      0.75 +
      0.25 * Math.sin(t * 7.3 + ph) * Math.sin(t * 3.1 + ph * 2) +
      0.12 * Math.sin(t * 11 + ph);
    const h = 13 * hk * fl * big;
    const lean = Math.sin(t * 2.3 + ph) * 2.4 + wind * 1.5;
    // a tongue: a rounded, tapered foot down among the logs, bellying out above it, leaning to its tip
    const by = fy + 2.5 - Math.abs(dx) * 0.35;
    g.beginPath();
    g.moveTo(fx + dx, by);
    g.bezierCurveTo(
      fx + dx - 3,
      by - 0.5,
      fx + dx - 5 + lean * 0.3,
      fy - 2 - h * 0.5,
      fx + dx + lean,
      fy - 2 - h,
    );
    g.bezierCurveTo(
      fx + dx + 5 + lean * 0.3,
      fy - 2 - h * 0.45,
      fx + dx + 3,
      by - 0.5,
      fx + dx,
      by,
    );
    g.closePath();
    g.fillStyle = i === 2 ? "#e9b24e" : "#cf7a3c";
    g.fill();
    if (i === 2) {
      g.beginPath();
      g.ellipse(
        fx + dx + lean * 0.3,
        fy - 4 - h * 0.2,
        1.8,
        h * 0.24,
        0,
        0,
        TAU,
      );
      g.fillStyle = "#f6dc8e";
      g.fill();
    }
  });
  // over the flames' feet: the embers, the near log, the near stones of the ring
  const em = 0.6 + 0.4 * Math.sin(t * 5.1);
  for (const [ex, ey, er] of [
    [-5, 2.2, 2.2],
    [0.5, 3, 2.6],
    [5.5, 2, 2],
  ] as const) {
    g.fillStyle = `rgba(226,120,50,${0.55 + 0.35 * em})`;
    g.beginPath();
    g.ellipse(fx + ex, fy + ey, er, er * 0.5, 0, 0, TAU);
    g.fill();
  }
  seg(g, fx - 9, fy + 3.4, fx + 8, fy + 1.6);
  bar(g, 2.8, "#33261d", null);
  g.fillStyle = `rgba(240,150,70,${0.5 * em})`;
  g.fillRect(fx - 3, fy + 1.6, 5, 1);
  for (let k = 0; k < RING; k++) if (ringNear(k)) ringStone(g, k);
  for (let i = 0; i < 3; i++) {
    const k = (t * 0.2 + i / 3) % 1;
    g.fillStyle = `rgba(214,210,198,${0.26 * (1 - k) * Math.min(1, k * 5)})`;
    g.beginPath();
    g.ellipse(
      fx + Math.sin(k * 5 + i * 2) * 3 + k * 10 * wind,
      fy - 14 - k * 44,
      2.5 + k * 7,
      2 + k * 5,
      0,
      0,
      TAU,
    );
    g.fill();
  }
  g.save();
  g.globalCompositeOperation = "lighter";
  const fg = g.createRadialGradient(fx, fy - 6, 2, fx, fy - 6, 30 * big);
  fg.addColorStop(
    0,
    `rgba(255,170,80,${(s.night ? 0.4 : 0.14) * (0.8 + 0.2 * Math.sin(t * 7.3))})`,
  );
  fg.addColorStop(1, "rgba(255,170,80,0)");
  g.fillStyle = fg;
  g.fillRect(fx - 40, fy - 46, 80, 70);
  g.restore();
}

const LAMP_LIGHTS: Light[] = [0, 1, 2, 3].map((i) => {
  const [x, y] = lampAt(i);
  return [x, y + 8, 11];
});

export const bandstand: BuildingSpec = {
  door: { kind: "opening", w: 40 },
  footprint: {
    w: 208,
    depth: 74,
    ground: [-183, -112, 184, 51],
    upper: [-116, -292, 116, -112],
  },
  setting: ["square"],
  signX: 158,
  lights: [
    [0, -60, 34],
    ...LAMP_LIGHTS,
    [0, CT - 6, 9],
    [FIRE[0], FIRE[1] - 6, 22],
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const A = accent(s.hue);
    const V = VERDIGRIS;
    // ONE shadow for the whole stand, lying to the right: two overlapping ones added up past SOLID_ALPHA,
    // and the hover outlined the patch of ground where they met
    ellShadow(g, 34, 2, 124, 22, 0.22);
    // the stone plinth: three faces to the front, a moulded coping, a base course
    for (const [i, j, sh] of [
      [3, 2, 0.1],
      [2, 1, 0],
      [1, 0, -0.18],
    ] as const) {
      const a = F(i);
      const b = F(j);
      const face: Pt[] = [a, b, [b[0], b[1] + PLINTH], [a[0], a[1] + PLINTH]];
      stones(
        g,
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[0], b[0]),
        Math.max(a[1], b[1]) + PLINTH,
        r,
        { rowH: 7, blockW: 15, base: "#aaa391", clip: () => poly(g, face) },
      );
      poly(g, face);
      tone(g, sh);
      seg(g, a[0], a[1] + 1.5, b[0], b[1] + 1.5);
      bar(g, 3.4, "#bdb5a2", "rgba(255,250,236,.4)");
      seg(g, a[0], a[1] + PLINTH - 1.5, b[0], b[1] + PLINTH - 1.5);
      bar(g, 3, "#8f8878", null);
    }
    // the deck: boards running to the back, darker under the roof
    const floor = [0, 1, 2, 3, 4, 5, 6, 7].map(F);
    g.save();
    poly(g, floor);
    g.clip();
    planks(g, -RX, CY - RY, RX, CY + RY, r, {
      base: "#9a8462",
      vertical: false,
      pw: 5,
    });
    const deck = g.createLinearGradient(0, CY - RY, 0, CY + RY);
    deck.addColorStop(0, "rgba(30,24,16,.5)");
    deck.addColorStop(0.7, "rgba(30,24,16,.12)");
    deck.addColorStop(1, "rgba(30,24,16,0)");
    g.fillStyle = deck;
    g.fillRect(-RX, CY - RY, 2 * RX, 2 * RY);
    g.restore();
    poly(g, floor);
    ink(g, 1.3);
    g.stroke();
    // open all round: through the far sides only their balustrades and columns stand against the landscape
    for (const [i, j] of [
      [4, 5],
      [5, 6],
      [6, 7],
    ] as const)
      balustrade(g, F(i), F(j), true);
    // the columns: cast iron on a stone foot, three brass collars
    const column = (k: number) => {
      const [x, y] = F(k);
      g.fillStyle = "#59544a";
      g.fillRect(x - 5, y - 5, 10, 6);
      ink(g, 0.9);
      g.strokeRect(x - 5, y - 5, 10, 6);
      seg(g, x, y - 5, x, y - HC + 2);
      bar(g, 3.6, IRON_GREEN, "rgba(190,206,190,.3)");
      for (const [yy, w] of [
        [y - 13, 2.6],
        [y - HC + 22, 2.6],
        [y - HC + 5, 3.4],
      ] as const) {
        g.fillStyle = BRASS;
        g.fillRect(x - w - 0.6, yy, 2 * w + 1.2, 2.4);
        ink(g, 0.6, 0.8);
        g.strokeRect(x - w - 0.6, yy, 2 * w + 1.2, 2.4);
      }
    };
    for (const k of [4, 5, 6, 7]) column(k);
    // ---- the players' things, back to front
    // an upright piano at the back of the deck, its stool
    const px = -56;
    const py = -77;
    g.fillStyle = "rgba(24,20,14,.3)";
    g.fillRect(px - 2, py - 2, 50, 5);
    // (a box: its lid seen from above, its right end receding, in shade)
    const pianoBox = oblique.box({
      x0: px,
      x1: px + 46,
      yb: py,
      yt: py - 41,
      d: 10,
    });
    oblique.fill(g, pianoBox.side, (pts) => {
      g.fillStyle = "#231a15";
      poly(g, pts);
      g.fill();
    });
    oblique.fill(g, pianoBox.top, (pts) => {
      g.fillStyle = "#57443a";
      poly(g, pts);
      g.fill();
    });
    oblique.inkFace(g, pianoBox.side, 1.1);
    oblique.inkFace(g, pianoBox.top, 1.1);
    wash(
      g,
      () => {
        g.beginPath();
        g.rect(px, py - 41, 46, 41);
      },
      [px, py - 41, px + 46, py],
      "#3f3027",
      r,
      { var: 20, blob: 6, lw: 1.3, shadeA: 0.3 },
    );
    g.fillStyle = "#2a201a";
    g.fillRect(px - 2, py - 24, 50, 7);
    ink(g, 1);
    g.strokeRect(px - 2, py - 24, 50, 7);
    g.fillStyle = "#e4dac0";
    g.fillRect(px + 1, py - 23, 44, 4);
    for (let i = 0; i < 15; i++) {
      ink(g, 0.4, 0.6);
      seg(g, px + 1 + i * 2.93, py - 23, px + 1 + i * 2.93, py - 19);
      g.stroke();
      if ([0, 1, 3, 4, 5].includes(i % 7)) {
        g.fillStyle = "#1f1a17";
        g.fillRect(px + 3.1 + i * 2.93, py - 23, 1.7, 2.5);
      }
    }
    ink(g, 0.7, 0.8);
    g.strokeRect(px + 1, py - 23, 44, 4);
    g.fillStyle = "#e6dcc0";
    g.fillRect(px + 14, py - 37, 18, 10);
    ink(g, 0.6, 0.7);
    g.strokeRect(px + 14, py - 37, 18, 10);
    seg(g, px + 23, py - 37, px + 23, py - 27);
    g.stroke();
    for (const x of [px + 6, px + 40]) {
      g.fillStyle = BRASS;
      g.fillRect(x - 1.5, py - 33, 3, 4);
      disc(g, x, py - 35, 1.6);
      g.fillStyle = lit ? "#ffe2a0" : "#e6dcc0";
      g.fill();
    }
    g.fillStyle = "#2a201a";
    g.fillRect(px + 3, py - 14, 3.4, 14);
    g.fillRect(px + 40, py - 14, 3.4, 14);
    g.fillStyle = "#5c4a36";
    g.fillRect(px + 15, py - 4, 2.4, 12);
    g.fillRect(px + 29, py - 4, 2.4, 12);
    g.fillStyle = mix(A, "#6a4a40", 0.45);
    g.beginPath();
    g.ellipse(px + 23, py - 5, 10, 3, 0, 0, TAU);
    g.fill();
    ink(g, 0.9);
    g.stroke();
    // a sousaphone on its stand: the brass bell is the brightest thing on the stage
    const bx = 60;
    const by = -70;
    g.strokeStyle = IRON;
    g.lineWidth = 1.4;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(bx - 7, by + 2);
    g.lineTo(bx, by - 5);
    g.lineTo(bx + 7, by + 2);
    g.moveTo(bx, by - 5);
    g.lineTo(bx, by - 10);
    g.stroke();
    g.beginPath();
    g.ellipse(bx + 1, by - 18, 8, 9.5, 0, 0, TAU);
    bar(g, 3.6, BRASS, BRASS_L);
    g.fillStyle = BRASS_D;
    for (const k of [-3, 0, 3]) g.fillRect(bx + k - 0.8, by - 21, 1.6, 6);
    g.beginPath();
    g.ellipse(bx - 2, by - 30, 13, 8.5, -0.2, 0, TAU);
    g.fillStyle = BRASS;
    g.fill();
    ink(g, 1.2);
    g.stroke();
    g.beginPath();
    g.ellipse(bx - 2, by - 30, 9.4, 5.8, -0.2, 0, TAU);
    g.fillStyle = "#6a5430";
    g.fill();
    ink(g, 0.7, 0.7);
    g.stroke();
    g.beginPath();
    g.ellipse(bx - 2.6, by - 29.4, 4.6, 2.8, -0.2, 0, TAU);
    g.fillStyle = "#33281a";
    g.fill();
    g.strokeStyle = "rgba(255,244,206,.65)";
    g.lineWidth = 1.2;
    g.beginPath();
    g.ellipse(bx - 2, by - 30, 11.6, 7.2, -0.2, 3.4, 4.6);
    g.stroke();
    // chairs, and a music stand at the back
    musicStand(g, 26, -72);
    chair(g, ACCORDION[0], ACCORDION[1], -1);
    chair(g, 52, -46, 1);
    // the bass viol on its stand (its strings move)
    viol(
      g,
      r,
      BASS,
      bassBody,
      "#8a5530",
      [-16, -56, 16, -6],
      "rgba(60,36,20,.5)",
      () => {
        ink(g, 0.9, 0.8);
        for (const k of [-1, 1]) {
          g.beginPath();
          g.moveTo(k * 7.5, -24);
          g.bezierCurveTo(k * 10, -27, k * 5, -30, k * 7.5, -34);
          g.stroke();
        }
        g.fillStyle = "#231c17";
        poly(g, [
          [-3.4, -9],
          [3.4, -9],
          [2, -22],
          [-2, -22],
        ]);
        g.fill();
        g.fillStyle = "#d9c79a";
        g.fillRect(-5.5, -30, 11, 1.8);
        ink(g, 0.5, 0.8);
        g.strokeRect(-5.5, -30, 11, 1.8);
        g.fillStyle = "#231c17";
        poly(g, [
          [-2.6, -38],
          [2.6, -38],
          [2, -84],
          [-2, -84],
        ]);
        g.fill();
        ink(g, 0.9);
        g.stroke();
        g.fillStyle = "#7a4a2a";
        poly(g, [
          [-2.4, -84],
          [2.4, -84],
          [3, -92],
          [-3, -92],
        ]);
        g.fill();
        ink(g, 0.9);
        g.stroke();
        g.beginPath();
        g.arc(0, -95, 3.2, 0.6, TAU - 0.2);
        bar(g, 1.8, "#7a4a2a", null);
        g.fillStyle = "#231c17";
        for (const k of [-1, 1])
          for (const yy of [-86, -90])
            g.fillRect(k * 3, yy - 0.8, k * 3.4, 1.6);
      },
    );
    // the guitar on its stand (its strings move)
    viol(
      g,
      r,
      GUITAR,
      guitarBody,
      "#b98f52",
      [-14, -46, 14, -5],
      "rgba(236,222,190,.7)",
      () => {
        disc(g, 0, -29, 5.4);
        g.fillStyle = mix(A, "#6a5040", 0.3);
        g.fill();
        disc(g, 0, -29, 4);
        g.fillStyle = "#1f1b17";
        g.fill();
        ink(g, 0.7);
        g.stroke();
        g.fillStyle = "#33291f";
        g.fillRect(-6.5, -15.4, 13, 3);
        ink(g, 0.7);
        g.strokeRect(-6.5, -15.4, 13, 3);
        g.fillStyle = "#e0d6ba";
        g.fillRect(-4.6, -15.9, 9.2, 1);
        g.fillStyle = "#2b2420";
        poly(g, [
          [-3.2, -44],
          [3.2, -44],
          [2.5, -72],
          [-2.5, -72],
        ]);
        g.fill();
        ink(g, 1);
        g.stroke();
        g.strokeStyle = BRASS_L;
        g.lineWidth = 0.7;
        for (const yy of [-49, -54, -58.5, -62.5, -66, -69]) {
          seg(g, -3, yy, 3, yy);
          g.stroke();
        }
        g.fillStyle = "#6d4c30";
        poly(g, [
          [-3, -72],
          [3, -72],
          [4.4, -77],
          [4, -83],
          [0, -84.5],
          [-4, -83],
          [-4.4, -77],
        ]);
        g.fill();
        ink(g, 1);
        g.stroke();
        for (const k of [-1, 1])
          for (const yy of [-75.5, -78.5, -81.5]) {
            g.fillStyle = "#d9cfb4";
            g.beginPath();
            g.ellipse(k * 5.8, yy, 1.5, 1.2, 0, 0, TAU);
            g.fill();
            ink(g, 0.5, 0.8);
            g.stroke();
          }
      },
    );
    // the conductor's stand at the front (its page turns)
    musicStand(g, STAND[0], STAND[1]);
    // the cast-iron balustrades on the slanted sides, then the front columns with their scrolled brackets
    for (const [i, j] of [
      [3, 2],
      [1, 0],
    ] as const)
      balustrade(g, F(i), F(j), false);
    for (const k of [3, 0, 2, 1]) {
      column(k);
      const [x, y] = F(k);
      const ty = y - HC;
      for (const d of [-1, 1]) {
        g.beginPath();
        g.moveTo(x, ty + 34);
        g.bezierCurveTo(
          x + d * 2,
          ty + 22,
          x + d * 10,
          ty + 20,
          x + d * 16,
          ty + 15,
        );
        bar(g, 1.5, IRON_GREEN, null);
        g.beginPath();
        g.arc(x + d * 7, ty + 23.5, 3, 0, TAU);
        bar(g, 1.1, IRON_GREEN, null);
      }
    }
    // the frieze: a fretwork band cut with notes on a staff, under the eave
    for (const [i, j, sh] of [
      [3, 2, 0.08],
      [1, 0, -0.14],
      [2, 1, 0],
    ] as const) {
      const a = F(i);
      const b = F(j);
      const band: Pt[] = [
        [a[0], a[1] - HC],
        [b[0], b[1] - HC],
        [b[0], b[1] - HC + 14],
        [a[0], a[1] - HC + 14],
      ];
      wash(g, () => poly(g, band), bbox(band), CREAM, r, {
        var: 16,
        blob: 5,
        lw: 1.2,
        shade: false,
      });
      poly(g, band);
      tone(g, sh);
      g.strokeStyle = "rgba(40,32,24,.55)";
      g.lineWidth = 0.6;
      for (const dy of [4.5, 7, 9.5]) {
        seg(g, a[0], a[1] - HC + dy, b[0], b[1] - HC + dy);
        g.stroke();
      }
      const n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 9);
      for (let k = 0; k < n; k++) {
        const p = lerp(a, b, (k + 0.5) / n);
        const dy = [9.5, 7, 4.5, 8.2, 5.8][(k * 3 + i) % 5] ?? 7;
        g.fillStyle = "rgba(40,32,24,.8)";
        g.beginPath();
        g.ellipse(p[0], p[1] - HC + dy, 1.9, 1.4, -0.4, 0, TAU);
        g.fill();
        g.strokeStyle = "rgba(40,32,24,.8)";
        g.lineWidth = 0.7;
        seg(g, p[0] + 1.6, p[1] - HC + dy, p[0] + 1.6, p[1] - HC + dy - 5.4);
        g.stroke();
      }
      seg(g, a[0], a[1] - HC + 14, b[0], b[1] - HC + 14);
      bar(g, 1.6, "#5a4632", null);
    }
    // the roof: eight copper facets gone green, standing seams running up to the cupola, the hips rolled
    // (a round roof's facets, curving up to the cupola: none of their edges is a receding edge of a box)
    oblique.diagonal(g, () => {
      const facet = (k: number) => {
        const e0 = hipOf(k);
        const e1 = hipOf(k + 1);
        const a0 = e0[0];
        const a1 = e1[0];
        if (!a0 || !a1) return;
        const fc: Pt[] = [...e0, ...[...e1].reverse()];
        const bb = bbox(fc);
        const L = FACET_LIGHT[k & 7] ?? 0;
        wash(g, () => poly(g, fc), bb, L < 0 ? dark(V, -L) : light(V, L), r, {
          var: 30,
          blob: 10,
          outline: false,
          shade: false,
        });
        g.save();
        poly(g, fc);
        g.clip();
        for (let i = 0; i < 26; i++) {
          const q = r();
          g.fillStyle =
            q < 0.22
              ? `rgba(150,96,58,${0.14 + r() * 0.2})`
              : q < 0.5
                ? `rgba(206,226,208,${0.08 + r() * 0.1})`
                : `rgba(40,58,50,${0.08 + r() * 0.12})`;
          g.beginPath();
          g.ellipse(
            bb[0] + r() * (bb[2] - bb[0]),
            bb[1] + r() * (bb[3] - bb[1]),
            3 + r() * 9,
            2 + r() * 5,
            r() * 3,
            0,
            TAU,
          );
          g.fill();
        }
        for (let m = 1; m < 5; m++) {
          g.beginPath();
          e0.forEach((p, j) => {
            const q = lerp(p, e1[j] ?? p, m / 5);
            if (j === 0) g.moveTo(q[0], q[1]);
            else g.lineTo(q[0], q[1]);
          });
          g.strokeStyle = "rgba(30,44,38,.42)";
          g.lineWidth = 1;
          g.stroke();
          g.strokeStyle = "rgba(220,236,222,.2)";
          g.lineWidth = 0.6;
          g.translate(-0.8, -0.3);
          g.stroke();
          g.translate(0.8, 0.3);
        }
        for (const j of [2, 4, 6]) {
          const p = e0[j];
          const q = e1[j];
          if (!p || !q) continue;
          g.strokeStyle = "rgba(30,44,38,.22)";
          g.lineWidth = 0.7;
          seg(g, p[0], p[1], q[0], q[1]);
          g.stroke();
        }
        streaks(g, r, bb, 7, "34,48,40", 0.14, 30);
        streaks(g, r, bb, 4, "206,226,208", 0.1, 22);
        const edge = g.createLinearGradient(0, bb[3] - 14, 0, bb[3]);
        edge.addColorStop(0, "rgba(255,252,236,0)");
        edge.addColorStop(1, "rgba(255,252,236,.14)");
        g.fillStyle = edge;
        g.fillRect(bb[0], bb[3] - 14, bb[2] - bb[0], 14);
        g.restore();
        seg(g, a0[0], a0[1], a1[0], a1[1]);
        ink(g, 1.5);
        g.stroke();
      };
      const roll = (k: number) => {
        g.beginPath();
        hipOf(k).forEach((p, j) =>
          j ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]),
        );
        bar(g, 2.6, light(V, 0.08), "rgba(226,240,228,.4)");
      };
      for (const k of [5, 4, 6]) facet(k);
      for (const k of [5, 6]) roll(k);
      for (const k of [3, 7]) facet(k);
      for (const k of [4, 7]) roll(k);
      for (const k of [2, 0, 1]) facet(k);
      for (const k of [3, 0, 2, 1]) roll(k);
    });
    // the eave: a fascia and a scalloped lambrequin, cream and the app's colour by turns
    for (const [i, j] of [
      [3, 2],
      [1, 0],
      [2, 1],
    ] as const) {
      const a = hipOf(i)[0];
      const b = hipOf(j)[0];
      if (!a || !b) continue;
      const n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 9);
      for (let k = 0; k < n; k++) {
        const p = lerp(a, b, k / n);
        const q = lerp(a, b, (k + 1) / n);
        g.beginPath();
        g.moveTo(p[0], p[1] + 3);
        g.lineTo(q[0], q[1] + 3);
        g.lineTo(q[0], q[1] + 7);
        g.quadraticCurveTo(
          (p[0] + q[0]) / 2,
          (p[1] + q[1]) / 2 + 17,
          p[0],
          p[1] + 7,
        );
        g.closePath();
        g.fillStyle = jit(k % 2 ? mix(A, "#a88a80", 0.3) : CREAM, r, 12);
        g.fill();
        ink(g, 0.8, 0.8);
        g.stroke();
      }
      seg(g, a[0], a[1] + 2.5, b[0], b[1] + 2.5);
      bar(g, 4.2, "#5d6f64", "rgba(214,232,216,.35)");
    }
    // the cupola: a little glazed lantern, a bell cap, a brass ball
    g.beginPath();
    g.moveTo(-RC, CT - 13);
    g.lineTo(-RC, CT);
    g.ellipse(0, CT, RC, RCY, 0, Math.PI, 0, true);
    g.lineTo(RC, CT - 13);
    g.closePath();
    g.fillStyle = CREAM;
    g.fill();
    ink(g, 1.2);
    g.stroke();
    for (let k = -2; k <= 2; k++) {
      const x = k * RC * 0.38;
      const yb = CT + RCY * Math.sqrt(Math.max(0, 1 - (x / RC) ** 2)) - 2;
      g.beginPath();
      g.moveTo(x - 2.6, yb);
      g.lineTo(x - 2.6, yb - 8);
      g.arc(x, yb - 8, 2.6, Math.PI, 0);
      g.lineTo(x + 2.6, yb);
      g.closePath();
      g.fillStyle = lit ? "#ffd98c" : "#39434a";
      g.fill();
      ink(g, 0.6, 0.8);
      g.stroke();
    }
    g.fillStyle = "rgba(30,26,20,.2)";
    g.fillRect(RC * 0.3, CT - 13, RC * 0.7, 16);
    const cap = () => {
      g.beginPath();
      g.moveTo(-RC - 4, CT - 12);
      g.bezierCurveTo(-RC * 0.5, CT - 15, -4, CT - 20, 0, CT - 30);
      g.bezierCurveTo(4, CT - 20, RC * 0.5, CT - 15, RC + 4, CT - 12);
      g.quadraticCurveTo(0, CT - 6, -RC - 4, CT - 12);
      g.closePath();
    };
    wash(g, cap, [-RC - 4, CT - 30, RC + 4, CT - 8], light(V, 0.06), r, {
      var: 26,
      blob: 5,
      lw: 1.3,
      shadeA: 0.34,
    });
    seg(g, 0, CT - 29, 0, CT - 40);
    bar(g, 2, BRASS, BRASS_L);
    disc(g, 0, CT - 34, 3.2);
    g.fillStyle = BRASS;
    g.fill();
    ink(g, 0.9);
    g.stroke();
    // the chord lanterns under the front eave, unlit (the lit one is drawn over)
    LAMPS.forEach((c, i) => {
      const [x, y] = lampAt(i);
      seg(g, x, y - 5, x, y + 3);
      ink(g, 0.8);
      g.stroke();
      g.fillStyle = IRON;
      g.fillRect(x - 4.5, y + 3, 9, 2);
      g.fillRect(x - 4.5, y + 14, 9, 2);
      g.fillStyle = mix(c ?? A, "#4a443c", 0.45);
      g.fillRect(x - 3.5, y + 5, 7, 9);
      ink(g, 0.8);
      g.strokeRect(x - 3.5, y + 5, 7, 9);
    });
    // the steps, between two stone cheeks with brass urns
    // (the steps come out of the plinth toward us; the cheeks stand either side of their foot and run back to the plinth,
    // so the left one is drawn first, then the steps, then the right one)
    const CHEEK_OUT = 12;
    for (const k of [-1, 1]) {
      if (k === 1) steps(g, 0, CY + RY * 0.924 - 1, 34, 5, r);
      g.save();
      g.translate(...oblique.back([0, 0], -CHEEK_OUT));
      const x = k * 43;
      oblique.solid(
        g,
        { x0: x - 7, x1: x + 7, yb: 3, yt: -20, d: 9 + CHEEK_OUT },
        {
          side: (d, yt, yb) =>
            stones(g, 0, yt, d, yb, r, {
              rowH: 7,
              blockW: 9,
              base: "#9d9584",
              outline: false,
            }),
          front: () =>
            stones(g, x - 7, -20, x + 7, 3, r, {
              rowH: 7,
              blockW: 12,
              base: "#b3ab98",
            }),
          ink: 1,
        },
      );
      oblique.solid(
        g,
        { x0: x - 9, x1: x + 9, yb: -19, yt: -23, d: 11 + CHEEK_OUT },
        {
          side: (d, yt, yb) => {
            g.fillStyle = "#a39b89";
            g.fillRect(0, yt, d, yb - yt);
          },
          top: (x0, x1, d) => {
            g.fillStyle = "#cbc3b0";
            g.fillRect(x0, 0, x1 - x0, d);
          },
          front: () => {
            g.fillStyle = "#bdb5a2";
            g.fillRect(x - 9, -23, 18, 4);
          },
          shade: 0.2,
          ink: 0.9,
        },
      );
      const [ux, uy] = oblique.back([x, -23], 5);
      g.beginPath();
      g.moveTo(ux - 2, uy);
      g.lineTo(ux - 5.4, uy - 8);
      g.quadraticCurveTo(ux, uy - 12, ux + 5.4, uy - 8);
      g.lineTo(ux + 2, uy);
      g.closePath();
      g.fillStyle = BRASS;
      g.fill();
      ink(g, 0.9);
      g.stroke();
      shrub(g, ux, uy - 8, 5, r, k > 0 ? 1 : 0);
      g.restore();
    }
    // the fire ring and its log seats
    const [fx, fy] = FIRE;
    ellShadow(g, fx + 3, fy + 1, 19, 7, 0.22);
    g.fillStyle = "#4a443a";
    g.beginPath();
    g.ellipse(fx, fy, 13, 5, 0, 0, TAU);
    g.fill();
    // the far stones of the ring (the near ones lie over the flames' feet: `campfire` draws them)
    for (let k = 0; k < RING; k++) if (!ringNear(k)) ringStone(g, k);
    for (const [x0, y0, x1, y1] of [
      [-7, 2, 8, -4],
      [7, 2, -7, -4],
      [-2, 3, 3, -6],
    ] as const) {
      seg(g, fx + x0, fy + y0, fx + x1, fy + y1);
      bar(g, 2.6, "#3a2c22", null);
    }
    for (const [x, y, w, a] of [
      [fx - 28, fy + 10, 26, 0.12],
      [fx + 26, fy + 14, 24, -0.14],
      [fx - 4, fy - 14, 22, 0.02],
    ] as const) {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      ellShadow(g, 4, 3, w * 0.6, 3, 0.26);
      g.beginPath();
      g.roundRect(-w / 2, -8, w, 9, 3);
      g.fillStyle = jit("#7d6648", r, 16);
      g.fill();
      ink(g, 1.1);
      g.stroke();
      g.beginPath();
      g.ellipse(w / 2, -3.5, 2.6, 4.5, 0, 0, TAU);
      g.fillStyle = "#b39a6e";
      g.fill();
      ink(g, 0.8);
      g.stroke();
      ink(g, 0.5, 0.4);
      seg(g, -w / 2 + 3, -4.5, w / 2 - 4, -5);
      g.stroke();
      g.restore();
    }
    moss(g, -96, 96, 2, r, 12);
    tufts(g, -104, -50, 4, r, 8);
    tufts(g, 50, 110, 4, r, 8);
    tufts(g, fx - 40, fx + 40, fy + 18, r, 8);
    ivy(g, -92, -10, -70, r, 10);
    for (const [x, y, z, k] of [
      [-124, -18, 14, 0],
      [124, -8, 14, 1],
      [84, 30, 9, 2],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    const A = accent(s.hue);
    const c = t / BAR;
    const ci = Math.floor(c) % CHORDS.length;
    const f = (c - Math.floor(c)) * BAR;
    const ch = CHORDS[ci];
    if (!ch) return;
    const on = Math.min(1, f / 0.25) * Math.min(1, (BAR - f) / 0.25);
    // the gilt lyre on the cupola swings in the wind
    const va =
      0.9 * Math.sin(t * 0.29) * (0.4 + gust(t, 4)) +
      0.2 * Math.sin(t * 0.9 + 1);
    g.save();
    g.translate(0, CT - 40);
    g.scale(Math.cos(va), 1);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(-5, 0);
    g.bezierCurveTo(-13, -6, -11, -16, -5, -20);
    g.moveTo(5, 0);
    g.bezierCurveTo(13, -6, 11, -16, 5, -20);
    g.moveTo(-6, 0);
    g.lineTo(6, 0);
    g.moveTo(-7, -17);
    g.lineTo(7, -17);
    for (const x of [-3, 0, 3]) {
      g.moveTo(x, 0);
      g.lineTo(x, -17);
    }
    g.strokeStyle = INK;
    g.lineWidth = 3.4;
    g.stroke();
    g.strokeStyle = "#c9ab62";
    g.lineWidth = 1.6;
    g.stroke();
    g.restore();
    // the strings: the chord's three or four ring on the guitar (a strum, then a softer one back), its root on the bass
    const n = ch.strings.length;
    strings(
      g,
      t,
      GUITAR,
      6,
      (j) => -4 + 1.6 * j,
      (j) => -2 + 0.8 * j,
      -15.4,
      -72,
      (j) => {
        const o = ch.strings.indexOf(j);
        if (o < 0) return 0;
        const a = f - o * 0.09;
        const b = f - 1.7 - (n - 1 - o) * 0.07;
        return (
          (a > 0 ? Math.exp(-a * 1.5) : 0) * 1.5 +
          (b > 0 ? Math.exp(-b * 2) : 0) * 0.9
        );
      },
      (j) => (j < 3 ? "#c8aa6a" : "#e6e0ce"),
    );
    strings(
      g,
      t,
      BASS,
      4,
      (j) => -3.6 + 2.4 * j,
      (j) => -1.5 + j,
      -29,
      -84,
      (j) =>
        j === ci
          ? Math.exp(-f * 1.1) * 2 +
            (f > 1.7 ? Math.exp(-(f - 1.7) * 1.6) * 1.3 : 0)
          : 0,
      () => "#d8ccae",
    );
    // the accordion on its chair: the bellows open on the chord and close through the bar
    const [ax, ay] = ACCORDION;
    const open =
      5 + 9 * (f < 0.5 ? f / 0.5 : Math.max(0, 1 - (f - 0.5) / (BAR - 0.7)));
    const xl = ax + 1 - open / 2;
    const xr = ax + 1 + open / 2;
    const ab = ay - 13;
    g.lineJoin = "round";
    g.fillStyle = "#b8a888";
    g.fillRect(xl, ab - 15, open, 16);
    for (let k = 0; k <= 5; k++) {
      const x = xl + (open * k) / 5;
      g.strokeStyle = k % 2 ? "rgba(48,38,28,.75)" : "rgba(120,60,50,.8)";
      g.lineWidth = 0.8;
      seg(g, x, ab - 15, x, ab + 1);
      g.stroke();
    }
    g.strokeStyle = INK;
    g.lineWidth = 0.9;
    g.fillStyle = mix(A, "#6a3f3a", 0.55);
    g.fillRect(xl - 7, ab - 17, 7, 19);
    g.strokeRect(xl - 7, ab - 17, 7, 19);
    g.fillRect(xr, ab - 16, 6, 17);
    g.strokeRect(xr, ab - 16, 6, 17);
    g.fillStyle = "#e2d8bc";
    g.fillRect(xr + 6, ab - 14, 3.4, 13);
    g.strokeRect(xr + 6, ab - 14, 3.4, 13);
    g.fillStyle = "#1f1a17";
    for (let k = 0; k < 4; k++)
      g.fillRect(xr + 7.6, ab - 12.6 + k * 3.1, 1.8, 1.5);
    g.fillStyle = BRASS_L;
    for (let k = 0; k < 3; k++)
      for (let q = 0; q < 2; q++)
        g.fillRect(xl - 5.4 + q * 2.6, ab - 13 + k * 4.4, 1.3, 1.3);
    // the conductor's page turns as the progression comes round again
    const turn = (c % CHORDS.length) - (CHORDS.length - 0.3);
    const [sx, sy] = STAND;
    if (turn > 0 && turn < 0.3) {
      const ph = Math.PI * (0.5 - 0.5 * Math.cos((turn / 0.3) * Math.PI));
      const ex = Math.cos(ph) * 10.4;
      const lift = Math.sin(ph) * 4;
      g.fillStyle = "#ece3c8";
      g.beginPath();
      g.moveTo(sx, sy - 42);
      g.lineTo(sx + ex, sy - 41.2 - lift);
      g.lineTo(sx + ex * 0.95, sy - 27 - lift);
      g.lineTo(sx, sy - 27.6);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(48,38,28,.8)";
      g.lineWidth = 0.7;
      g.stroke();
    }
    // the chimes in the frieze: the chord's three or four swing and settle
    CHIMES.forEach(([x, y, len], i) => {
      const o = ch.chimes.indexOf(i);
      const tau = o < 0 ? -1 : f - o * 0.12;
      g.save();
      g.translate(x, y);
      g.rotate(tau > 0 ? 0.55 * Math.exp(-tau * 0.9) * Math.sin(tau * 7) : 0);
      g.strokeStyle = "rgba(48,38,28,.8)";
      g.lineWidth = 0.7;
      seg(g, 0, 0, 0, 4);
      g.stroke();
      g.fillStyle = tau > 0 && tau < 0.5 ? "#f0d894" : BRASS;
      g.fillRect(-1.3, 4, 2.6, len);
      g.lineWidth = 0.6;
      g.strokeRect(-1.3, 4, 2.6, len);
      g.restore();
    });
    // the lantern for this chord
    const [lx, ly] = lampAt(ci);
    const col = LAMPS[ci] ?? A;
    g.globalAlpha = on * (s.night || s.dusk ? 1 : 0.85);
    g.fillStyle = light(col, 0.45);
    g.fillRect(lx - 3.5, ly + 5, 7, 9);
    g.fillStyle = "rgba(255,246,214,.75)";
    g.fillRect(lx - 1.3, ly + 7, 2.6, 5);
    g.strokeStyle = INK;
    g.lineWidth = 0.8;
    g.strokeRect(lx - 3.5, ly + 5, 7, 9);
    g.globalAlpha = 1;
    g.save();
    g.globalCompositeOperation = "lighter";
    const lg = g.createRadialGradient(
      lx,
      ly + 9,
      1,
      lx,
      ly + 9,
      s.night ? 28 : 16,
    );
    lg.addColorStop(0, mix(col, "#ffe6a8", 0.5, 0.55 * on));
    lg.addColorStop(1, mix(col, "#ffe6a8", 0.5, 0));
    g.fillStyle = lg;
    g.fillRect(lx - 30, ly - 21, 60, 60);
    // the stage warms with each strum (after sunset)
    if (s.night || s.dusk) {
      const fl = g.createRadialGradient(0, CY - 20, 4, 0, CY - 20, 96);
      fl.addColorStop(
        0,
        `rgba(255,214,140,${0.12 + 0.12 * Math.exp(-f * 1.4)})`,
      );
      fl.addColorStop(1, "rgba(255,214,140,0)");
      g.fillStyle = fl;
      g.fillRect(-104, CY - 70, 208, 110);
    }
    g.restore();
  },
  // the campfire beside it and the sparrow: never part of its shape
  ambient(g, s) {
    const c = s.t / BAR;
    const ci = Math.floor(c) % CHORDS.length;
    const f = (c - Math.floor(c)) * BAR;
    campfire(g, s);
    // a sparrow on the balustrade, hopping along it at every strum
    if (!s.night) {
      const hop = f < 0.5 ? Math.sin((f / 0.5) * Math.PI) : 0;
      const dir = ci % 2 ? 1 : -1;
      const along = dir * 5 * ((f < 0.5 ? f / 0.5 : 1) - 1);
      const peck = f > 2.2 && f < 2.6 ? Math.sin((f - 2.2) * 7.85) : 0;
      bird(
        g,
        PERCH[0] + along,
        PERCH[1] - 26.5 - along * 0.32 - hop * 5,
        dir,
        "#8a7460",
        peck,
      );
    }
  },
};
