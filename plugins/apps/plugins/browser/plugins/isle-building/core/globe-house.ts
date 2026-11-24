// The Browser's building on Isle: the world globe — a riveted globe of aged
// enamel seas and oxidised copper continents, hung in a brass meridian ring on
// a squat stone drum. It is the web at work: small lights run the great
// circles between its cities like requests, a packet ship works across the
// Atlantic, the semaphore on its pole signals, a tin relay moon rides the
// orbit rail, and the spyglass tracks slowly across the sky.

import {
  accent,
  dark,
  doorArch,
  fittings,
  grain,
  ink,
  ivy,
  jit,
  light,
  mix,
  moss,
  shrub,
  steps,
  tufts,
  windowRect,
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
  VERDIGRIS,
  STONE,
  clamp01,
  ease,
  disc,
  seg,
  ellShadow,
  bar,
  rivet,
  streaks,
  porthole,
  drum,
  glowPane,
} = fittings;

type V3 = readonly [number, number, number];

const GRAIN_BOX: Box = [-210, -370, 210, 60];
const D2R = Math.PI / 180;
const R = 96;
const CX = 0;
const CY = -194;
/** The longitude facing us, the pole's tip toward us, its roll to the right. */
const L0 = -38;
const PHI = 0.36;
const RHO = 0.36;
/** The top of the drum. */
const YT = -100;
const cp = Math.cos(PHI);
const sp = Math.sin(PHI);
const cr = Math.cos(RHO);
const sr = Math.sin(RHO);

/** A place on the sphere, before the globe's tilt. */
function vec(lon: number, lat: number): V3 {
  const a = (lon - L0) * D2R;
  const b = lat * D2R;
  return [Math.cos(b) * Math.sin(a), Math.sin(b), Math.cos(b) * Math.cos(a)];
}
/** Orthographic view: north pole tipped toward us and rolled to the right; z > 0 faces us. */
function turn(v: V3): V3 {
  const y1 = v[1] * cp - v[2] * sp;
  const z1 = v[1] * sp + v[2] * cp;
  return [v[0] * cr + y1 * sr, -v[0] * sr + y1 * cr, z1];
}
const proj = (lon: number, lat: number): V3 => turn(vec(lon, lat));
/** The point `u` of the way along the great circle from `a` to `b`. */
function slerp(a: V3, b: V3, u: number): V3 {
  const d = Math.acos(clamp01(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const sd = Math.sin(d) || 1;
  const ka = Math.sin((1 - u) * d) / sd;
  const kb = Math.sin(u * d) / sd;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
}

/** The continents on the side we see, as [longitude, latitude] outlines. */
const LAND: readonly (readonly Pt[])[] = [
  // Africa
  [
    [-17, 15],
    [-16, 22],
    [-13, 28],
    [-6, 35],
    [3, 37],
    [10, 37],
    [11, 33],
    [20, 32],
    [25, 32],
    [32, 31],
    [35, 24],
    [38, 18],
    [43, 11],
    [51, 11],
    [46, 3],
    [40, -3],
    [40, -16],
    [35, -20],
    [33, -26],
    [26, -34],
    [18, -34],
    [15, -27],
    [12, -17],
    [13, -8],
    [9, 0],
    [9, 4],
    [2, 6],
    [-8, 5],
    [-13, 9],
  ],
  // Europe and Asia
  [
    [-9, 37],
    [-9, 43],
    [-2, 44],
    [-4, 48],
    [1, 50],
    [4, 52],
    [8, 54],
    [8, 57],
    [5, 59],
    [6, 62],
    [12, 66],
    [18, 70],
    [25, 71],
    [40, 67],
    [45, 68],
    [70, 72],
    [100, 75],
    [100, 12],
    [80, 12],
    [72, 20],
    [60, 25],
    [57, 22],
    [52, 16],
    [44, 12],
    [42, 16],
    [35, 28],
    [36, 36],
    [28, 36],
    [27, 41],
    [22, 40],
    [23, 36],
    [19, 42],
    [13, 45],
    [16, 40],
    [12, 44],
    [8, 44],
    [3, 43],
    [0, 39],
    [-5, 36],
  ],
  // North America
  [
    [-168, 66],
    [-162, 60],
    [-150, 60],
    [-140, 59],
    [-130, 54],
    [-124, 48],
    [-124, 40],
    [-117, 33],
    [-110, 23],
    [-105, 20],
    [-97, 16],
    [-88, 14],
    [-83, 9],
    [-78, 8],
    [-83, 13],
    [-88, 17],
    [-87, 21],
    [-90, 21],
    [-97, 22],
    [-97, 28],
    [-90, 30],
    [-84, 30],
    [-81, 25],
    [-80, 31],
    [-76, 35],
    [-70, 42],
    [-66, 45],
    [-60, 46],
    [-65, 49],
    [-56, 52],
    [-62, 58],
    [-78, 58],
    [-80, 52],
    [-88, 57],
    [-94, 60],
    [-85, 66],
    [-82, 70],
    [-95, 72],
    [-125, 70],
    [-155, 71],
  ],
  // South America
  [
    [-78, 8],
    [-72, 12],
    [-62, 10],
    [-52, 5],
    [-50, 0],
    [-44, -2],
    [-35, -6],
    [-39, -15],
    [-41, -22],
    [-48, -26],
    [-54, -34],
    [-58, -38],
    [-65, -42],
    [-68, -52],
    [-74, -52],
    [-72, -40],
    [-71, -30],
    [-70, -18],
    [-76, -14],
    [-81, -5],
    [-78, 2],
  ],
  // Greenland
  [
    [-45, 60],
    [-32, 68],
    [-22, 70],
    [-20, 80],
    [-40, 83],
    [-60, 80],
    [-55, 70],
  ],
  // Britain, Iceland, Cuba
  [
    [-6, 50],
    [2, 52],
    [-2, 58],
    [-7, 57],
  ],
  [
    [-22, 64],
    [-14, 64],
    [-15, 66],
    [-23, 66],
  ],
  [
    [-84, 22],
    [-75, 20],
    [-74, 19],
    [-84, 21],
  ],
];

function landPath(g: Ctx2D): void {
  g.beginPath();
  for (const pl of LAND) {
    for (let i = 0; i < pl.length; i++) {
      const A = pl[i]!;
      const B = pl[(i + 1) % pl.length]!;
      for (let k = 0; k < 4; k++) {
        const t = k / 4;
        const v = proj(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t);
        let x = v[0];
        let y = v[1];
        if (v[2] < 0) {
          // behind the limb: slid out to the edge, where the clip hides it
          const n = Math.hypot(x, y) || 1;
          x /= n;
          y /= n;
        }
        if (!i && !k) g.moveTo(CX + R * x, CY - R * y);
        else g.lineTo(CX + R * x, CY - R * y);
      }
    }
    g.closePath();
  }
}

function graticulePath(g: Ctx2D): void {
  g.beginPath();
  const run = (f: (u: number) => V3) => {
    let on = false;
    for (let u = -180; u <= 180; u += 5) {
      const [x, y, z] = f(u);
      if (z > 0.02) {
        if (on) g.lineTo(CX + R * x, CY - R * y);
        else g.moveTo(CX + R * x, CY - R * y);
        on = true;
      } else on = false;
    }
  };
  for (let lat = -60; lat <= 60; lat += 30) run((u) => proj(u, lat));
  for (let lon = -180; lon < 180; lon += 30) run((u) => proj(lon, u * 0.47));
}

/** The cities the web runs between. */
const CITIES: readonly V3[] = (
  [
    [-74, 41],
    [0, 51],
    [-9, 39],
    [-43, -23],
    [-17, 15],
    [-22, 64],
    [31, 30],
    [-82, 23],
  ] as const
).map(([lon, lat]) => vec(lon, lat));
/** The routes requests travel: from, to (indices of CITIES), seconds per trip, phase. */
const ROUTES = [
  [0, 1, 7.5, 0],
  [1, 6, 6.1, 2.2],
  [2, 3, 8.3, 4.1],
  [4, 0, 9.2, 1.3],
  [5, 1, 5.4, 3.6],
  [3, 4, 6.8, 5.9],
  [7, 2, 10.1, 0.7],
] as const;
/** The orbit rail the moon rides: centre y, rx, ry, tilt. */
const RAIL = [CY + 12, 124, 28, -0.2] as const;
function railPt(th: number): Pt {
  const lx = Math.cos(th) * RAIL[1];
  const ly = Math.sin(th) * RAIL[2];
  const c = Math.cos(RAIL[3]);
  const sn = Math.sin(RAIL[3]);
  return [CX + lx * c - ly * sn, RAIL[0] + lx * sn + ly * c];
}
/** The hatch the spyglass looks out of, and the semaphore's upper pivot. */
const SPY: Pt = [-53, CY - 59];
const SEMA = CY - R - 34;
/** The semaphore's alphabet: the two arms' angles, held then swung to the next. */
const SIGNS = [
  [-2.4, -0.7],
  [-1.57, 0.6],
  [-3.6, -1.57],
  [-2.4, 0.6],
  [-0.7, -3.6],
  [-1.57, -1.57],
] as const;

export const globeHouse: BuildingSpec = {
  door: { kind: "leaf", w: 34, h: 56, head: 17 },
  footprint: {
    w: 184,
    depth: 104,
    ground: [-146, -112, 180, 39],
    upper: [-136, -357, 136, -112],
  },
  setting: ["hill"],
  signX: 128,
  lights: [
    [-52, -58, 12],
    [52, -58, 12],
    [0, -34, 14],
    [-59, -203, 11],
    [-21, -130, 11],
    [32, -123, 11],
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const O = mix(accent(s.hue), VERDIGRIS, 0.5);
    const LANDC = "#86684a";
    ellShadow(g, 48, 8, 112, 22, 0.23);
    // the orbit rail's far half, then the brass meridian ring the globe hangs in
    g.beginPath();
    g.ellipse(CX, RAIL[0], RAIL[1], RAIL[2], RAIL[3], Math.PI, TAU);
    bar(g, 2.4, BRASS_D, BRASS);
    disc(g, CX, CY, R + 12);
    bar(g, 9, BRASS, "rgba(226,204,150,.55)");
    ink(g, 0.7, 0.5);
    for (let k = 0; k < 72; k++) {
      const a = (k * TAU) / 72;
      const l = k % 6 ? 2 : 3.4;
      seg(
        g,
        CX + Math.cos(a) * (R + 16.5),
        CY + Math.sin(a) * (R + 16.5),
        CX + Math.cos(a) * (R + 16.5 - l),
        CY + Math.sin(a) * (R + 16.5 - l),
      );
      g.stroke();
    }
    for (let k = 0; k < 34; k++) {
      const a = r() * TAU;
      g.fillStyle = `rgba(110,150,134,${0.25 + r() * 0.3})`;
      g.beginPath();
      g.ellipse(
        CX + Math.cos(a) * (R + 12),
        CY + Math.sin(a) * (R + 12),
        2 + r() * 3,
        1.6 + r() * 1.6,
        a,
        0,
        TAU,
      );
      g.fill();
    }
    // the stone drum it sits in
    drum(g, r, {
      rb: 84,
      rt: 78,
      yb: -14,
      yt: YT,
      ey: 14,
      row: 10,
      joint: 0.25,
      top: "#4a4038",
      tone: STONE,
    });
    // the globe: sea plates under aged enamel, continents of oxidised copper
    g.save();
    disc(g, CX, CY, R);
    g.clip();
    const og = g.createRadialGradient(CX - 30, CY - 35, 5, CX, CY, R * 1.05);
    og.addColorStop(0, light(O, 0.2));
    og.addColorStop(0.5, O);
    og.addColorStop(1, dark(O, 0.38));
    g.fillStyle = og;
    g.fillRect(CX - R, CY - R, 2 * R, 2 * R);
    for (let i = 0; i < 190; i++) {
      g.fillStyle =
        r() < 0.2 ? `rgba(150,96,58,${0.1 + r() * 0.14})` : jit(O, r, 40, 0.22);
      g.beginPath();
      g.ellipse(
        CX - R + r() * 2 * R,
        CY - R + r() * 2 * R,
        3 + r() * 9,
        2 + r() * 5,
        r() * 3,
        0,
        TAU,
      );
      g.fill();
    }
    g.save();
    landPath(g);
    g.shadowColor = "rgba(20,30,34,.4)";
    g.shadowBlur = 4;
    g.shadowOffsetX = 2;
    g.shadowOffsetY = 3;
    g.fillStyle = LANDC;
    g.fill();
    g.restore();
    g.save();
    landPath(g);
    g.clip();
    for (let i = 0; i < 220; i++) {
      const k = r();
      g.fillStyle =
        k < 0.3
          ? `rgba(126,160,140,${0.2 + r() * 0.3})`
          : k < 0.65
            ? jit("#9a7450", r, 34, 0.5)
            : jit("#6a5038", r, 28, 0.45);
      g.beginPath();
      g.ellipse(
        CX - R + r() * 2 * R,
        CY - R + r() * 2 * R,
        3 + r() * 6,
        2 + r() * 4,
        r() * 3,
        0,
        TAU,
      );
      g.fill();
    }
    landPath(g);
    g.strokeStyle = "rgba(136,170,150,.55)";
    g.lineWidth = 2.6;
    g.stroke();
    g.restore();
    landPath(g);
    ink(g, 1, 0.8);
    g.stroke();
    graticulePath(g);
    g.strokeStyle = "rgba(28,34,36,.36)";
    g.lineWidth = 1;
    g.stroke();
    g.strokeStyle = "rgba(255,250,230,.12)";
    g.lineWidth = 0.7;
    g.translate(-0.8, -0.8);
    g.stroke();
    g.translate(0.8, 0.8);
    for (let lat = -60; lat <= 60; lat += 30)
      for (let lon = -180; lon < 180; lon += 10) {
        const [x, y, z] = proj(lon, lat);
        if (z > 0.15) rivet(g, CX + R * x, CY - R * y, 0.7);
      }
    streaks(g, r, [CX - R, CY - 30, CX + R, CY + R], 24, "40,50,46", 0.13, 44);
    streaks(
      g,
      r,
      [CX - R, CY - 14, CX + R, CY + R],
      10,
      "190,214,196",
      0.1,
      30,
    );
    // the cities: brass studs the routes run between
    for (const c of CITIES) {
      const [x, y, z] = turn(c);
      if (z > 0.1) {
        disc(g, CX + R * x, CY - R * y, 2.2);
        g.fillStyle = BRASS_L;
        g.fill();
        ink(g, 0.7, 0.8);
        g.stroke();
      }
    }
    const sh = g.createRadialGradient(
      CX - 35,
      CY - 40,
      8,
      CX + 4,
      CY + 5,
      R * 1.1,
    );
    sh.addColorStop(0, "rgba(255,252,236,.22)");
    sh.addColorStop(0.45, "rgba(255,252,236,0)");
    sh.addColorStop(0.72, "rgba(22,24,26,.14)");
    sh.addColorStop(1, "rgba(22,24,26,.58)");
    g.fillStyle = sh;
    g.fillRect(CX - R, CY - R, 2 * R, 2 * R);
    g.restore();
    disc(g, CX, CY, R);
    ink(g, 1.7);
    g.stroke();
    // brass collar where the globe sits in the drum
    g.beginPath();
    g.ellipse(0, YT, 78, 14, 0, 0.02, Math.PI - 0.02);
    bar(g, 5, BRASS, BRASS_L);
    // portholes along the southern seas
    for (const [x, y, pr] of [
      [-59, -203, 9],
      [-21, -130, 10],
      [32, -123, 9],
    ] as const)
      porthole(g, x, y, pr, lit);
    // near half of the rail, the polar pivot, the hatch the spyglass looks out of, the semaphore mast
    g.beginPath();
    g.ellipse(CX, RAIL[0], RAIL[1], RAIL[2], RAIL[3], 0, Math.PI);
    bar(g, 2.4, BRASS, BRASS_L);
    const px = CX + R * cp * sr;
    const py = CY - R * cp * cr;
    seg(g, px, py, CX + (R + 12) * sr, CY - (R + 12) * cr);
    bar(g, 3.6, BRASS, BRASS_L);
    disc(g, px, py, 5);
    g.fillStyle = BRASS_D;
    g.fill();
    ink(g, 1);
    g.stroke();
    disc(g, SPY[0], SPY[1], 10);
    g.fillStyle = "#2a2622";
    g.fill();
    ink(g, 1.1);
    g.stroke();
    disc(g, SPY[0], SPY[1], 11.5);
    g.strokeStyle = BRASS_D;
    g.lineWidth = 2;
    g.stroke();
    seg(g, CX, CY - R - 17, CX, SEMA - 14);
    bar(g, 2.6, "#6e573f", "rgba(255,240,210,.3)");
    disc(g, CX, CY - R - 20, 4.4);
    g.fillStyle = BRASS;
    g.fill();
    ink(g, 1);
    g.stroke();
    // the drum: windows, door, ivy and moss
    windowRect(g, -62, -40, 20, 34, r, { arch: true, lit, sill: "#a49d8c" });
    windowRect(g, 42, -40, 20, 34, r, { arch: true, lit, sill: "#a49d8c" });
    doorArch(g, 0, 0, 34, 56, r, { col: accent(s.hue) });
    steps(g, 0, 2, 38, 2, r);
    ivy(g, -78, -4, -94, r, 18);
    moss(g, -84, 84, 0, r, 18);
    tufts(g, -110, 96, 4, r, 26);
    for (const [x, y, z, k] of [
      [-126, 12, 17, 0],
      [-100, 32, 9, 2],
      [122, -12, 14, 1],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    g.save();
    disc(g, CX, CY, R - 1.2);
    g.clip();
    // thin weather drifting over the seas
    for (const [i, off, y, sc] of [
      [0, 0, -240, 1.1],
      [1, 190, -164, 1.25],
    ] as const) {
      const span = 2 * R + 180;
      const x = ((t * (3 + i) + off) % span) - R - 90;
      g.fillStyle = "rgba(240,238,226,.34)";
      for (const [dx, dy, w, h] of [
        [0, 0, 20, 4.5],
        [14, -4, 14, 4.5],
        [-13, 3, 13, 3.6],
      ] as const) {
        g.beginPath();
        g.ellipse(x + dx * sc, y + dy * sc, w * sc, h * sc, -0.12, 0, TAU);
        g.fill();
      }
    }
    // a packet ship working across the Atlantic and back
    {
      const c = (t / 46) % 2;
      const u = c < 1 ? c : 2 - c;
      const [x, y] = proj(-68 + 50 * ease(u), 27 + 6 * Math.sin(u * Math.PI));
      const sx = CX + R * x;
      const sy = CY - R * y;
      const d = c < 1 ? 1 : -1;
      const bob = Math.sin(t * 1.3) * 0.5;
      g.strokeStyle = "rgba(240,244,240,.4)";
      g.lineWidth = 0.8;
      seg(g, sx - d * 3, sy + 1.6, sx - d * 9, sy + 2.2);
      g.stroke();
      g.fillStyle = "#3a332c";
      g.beginPath();
      g.moveTo(sx - 4, sy + bob);
      g.lineTo(sx + 4, sy + bob);
      g.lineTo(sx + 2.6, sy + 2.2 + bob);
      g.lineTo(sx - 2.6, sy + 2.2 + bob);
      g.closePath();
      g.fill();
      g.fillStyle = "#e6dfcb";
      g.beginPath();
      g.moveTo(sx - d * 0.5, sy - 6 + bob);
      g.lineTo(sx + d * 3.4, sy - 0.6 + bob);
      g.lineTo(sx - d * 0.5, sy - 0.6 + bob);
      g.closePath();
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 0.6;
      g.stroke();
    }
    // requests: small lights running the great circles between the cities, there and back
    ROUTES.forEach(([ia, ib, per, ph], i) => {
      const c = (t + ph) / per;
      const n = Math.floor(c);
      const f = (c - n) / 0.62;
      if (f >= 1) return;
      const back = (n + i) % 2 === 1;
      const a = CITIES[back ? ib : ia]!;
      const b = CITIES[back ? ia : ib]!;
      for (let k = 0; k < 4; k++) {
        const u = ease(clamp01(f)) - k * 0.035;
        if (u < 0) break;
        const [x, y, z] = turn(slerp(a, b, u));
        if (z < 0.05) continue;
        g.fillStyle = k
          ? `rgba(255,226,150,${0.5 - k * 0.13})`
          : s.night || s.dusk
            ? "#fff6d2"
            : "#ffe9ae";
        disc(g, CX + R * x, CY - R * y, k ? 1.5 : 2.4);
        g.fill();
        if (!k) {
          g.strokeStyle = "rgba(60,40,20,.7)";
          g.lineWidth = 0.6;
          g.stroke();
        }
      }
    });
    g.restore();
    glowPane(g, s, -21, -130, 9.5, null, 1.3);
    // the spyglass tracks slowly across the sky, and dwells
    g.save();
    g.translate(SPY[0], SPY[1]);
    g.rotate(
      -2.42 +
        0.3 * Math.tanh(2.6 * Math.sin(t * 0.22)) +
        0.05 * Math.sin(t * 0.05),
    );
    g.scale(1.1, 1.1);
    const tb = g.createLinearGradient(0, -6, 0, 6);
    tb.addColorStop(0, "#6e5530");
    tb.addColorStop(0.5, "#a8874f");
    tb.addColorStop(1, "#d8b878");
    g.fillStyle = tb;
    g.beginPath();
    g.moveTo(-2, -5);
    g.lineTo(52, -7.5);
    g.lineTo(52, 7.5);
    g.lineTo(-2, 5);
    g.closePath();
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1.4;
    g.lineJoin = "round";
    g.stroke();
    g.fillStyle = BRASS_D;
    g.fillRect(14, -7, 2.6, 14);
    g.fillRect(32, -7, 2.6, 14);
    g.fillStyle = "#2a2622";
    g.fillRect(50, -8.5, 5, 17);
    g.lineWidth = 1.2;
    g.strokeRect(50, -8.5, 5, 17);
    g.restore();
    // the semaphore on the pole signals: each sign held, then the arms swing to the next
    {
      const c = t / 3.4;
      const n = Math.floor(c);
      const u = ease(clamp01((c - n) / 0.28));
      const A = SIGNS[n % SIGNS.length]!;
      const B = SIGNS[(n + 1) % SIGNS.length]!;
      for (const k of [0, 1] as const) {
        const a = A[k] + (B[k] - A[k]) * u;
        const py2 = SEMA - 11 + k * 11;
        const ex = CX + Math.cos(a) * 15;
        const ey = py2 + Math.sin(a) * 15;
        g.lineCap = "round";
        seg(g, CX, py2, ex, ey);
        g.strokeStyle = "rgba(48,38,28,.88)";
        g.lineWidth = 4.4;
        g.stroke();
        g.strokeStyle = k ? "#b9ad92" : "#8f5a48";
        g.lineWidth = 2.4;
        g.stroke();
        disc(g, CX, py2, 1.8);
        g.fillStyle = BRASS;
        g.fill();
      }
    }
    // the tin moon riding the rail: the relay — its lamp answers as it goes round
    const th = t * 0.36;
    const [mx, my] = railPt(th);
    g.save();
    if (Math.sin(th) < 0) {
      // behind the globe: everything but the globe's disc
      g.beginPath();
      g.rect(-400, -500, 800, 600);
      g.arc(CX, CY, R + 17, 0, TAU);
      g.clip("evenodd");
    }
    disc(g, mx, my, 11);
    g.fillStyle = "#ded7c2";
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = "rgba(50,48,52,.34)";
    disc(g, mx + 6.5, my + 5.6, 11);
    g.fill();
    g.fillStyle = "rgba(110,104,90,.5)";
    disc(g, mx - 4, my - 2.6, 2.6);
    g.fill();
    g.restore();
    disc(g, mx, my, 11);
    g.strokeStyle = INK;
    g.lineWidth = 1.3;
    g.stroke();
    const blink = Math.max(0, Math.sin(t * 2.1)) ** 6;
    g.fillStyle = `rgba(255,232,160,${0.25 + 0.75 * blink})`;
    disc(g, mx + 2, my - 1, 2.4);
    g.fill();
    g.restore();
  },
};
