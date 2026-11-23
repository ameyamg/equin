// Home's building on Isle: the gatehouse inn at the crossroads — a steep
// front-gabled house (the one shape everybody draws for "home": stone below,
// lime plaster and oak framing above, bargeboards in the app's faded paint)
// with a carriage arch through its stone wing and a bell-cote astride the
// ridge, whose gable carries a great signboard of nine enamelled tiles, the
// grid of apps. It is the launcher at work: one tile at a time turns over on its
// pivot to show another face, and glows a while at night; the top arm of the
// fingerpost in the yard swings round to point a new way, overshoots and
// settles; the welcome lantern by the door sways, burns from dusk and draws
// two moths.

import {
  accent,
  barrel,
  bbox,
  castShadow,
  dark,
  doorArch,
  fittings,
  grain,
  hline,
  ink,
  ivy,
  light,
  mix,
  moss,
  oblique,
  poly,
  polyKit,
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
  type Pt,
  type Rnd,
} from "@plugins/apps/plugins/isle/plugins/buildings/core";

const {
  TAU,
  INK,
  IRON,
  BRASS,
  clamp01,
  ease,
  disc,
  seg,
  ellShadow,
  bar,
  rivet,
  streaks,
  porthole,
  gust,
  glowPane,
} = fittings;

const GRAIN_BOX: Box = [-190, -290, 196, 50];

/** The front wall: its sides, the eaves line and the apex of the gable. */
const L = -100;
const R = 100;
const EAVE = -104;
const APEX = -224;
/** How deep the house is: how far its side wall and its roof go back. */
const D = 28;
/** The gable's edge at x: how high the wall stands there. */
const gableY = (x: number): number => APEX + (Math.abs(x) * (EAVE - APEX)) / R;

/** Slates on a roof plane that recedes along the view vector: their rows run with the eave. */
function recedingSlates(g: Ctx2D, pts: readonly Pt[], r: Rnd): void {
  // in side-face space (from x = 0) the plane is flat: un-shear its points, tile it there
  oblique.onSide(g, 0, () =>
    shingles(
      g,
      pts.map(([x, y]): Pt => [x, y + oblique.rise(x)]),
      r,
      { base: "#686b70", rowH: 6.5, w: 9 },
    ),
  );
}

/** The signboard: its tiles' pitch, the top-left of the grid, a tile's side. */
const PITCH = 21;
const GRID: Pt = [-31.5, -176.5];
const TILE = 18;
/** The enamels, weathered: a tile shows one, and the next when it turns over. */
const ENAMEL = [
  "#9c6452",
  "#b09a62",
  "#677f88",
  "#788764",
  "#85728c",
  "#a87a50",
  "#5d7b76",
  "#9a917f",
  "#7f5f66",
  "#63748a",
  "#a08a5a",
] as const;
/** The order the tiles turn in. */
const TURNS = [4, 0, 7, 2, 8, 3, 6, 1, 5] as const;
/** Seconds between two turns, and how long one takes. */
const TURN_EVERY = 3.4;
const TURN_TAKES = 1.1;

/** The welcome lantern: where its chain hangs from the bracket. */
const LAMP: Pt = [32, -92];
/** The fingerpost in the yard: the foot of its post, and its height. */
const POST: Pt = [148, 28];
const POST_H = 74;
/** The ways the top arm points, one after the other (radians round the post). */
const WAYS = [0.3, 2.6, 4.5, 1.4, 5.7, 3.5] as const;
const WAY_EVERY = 8.5;

/** One arm of the fingerpost, from the post at height `y`: `len` signed, its tip `rise` higher. */
function arm(
  g: Ctx2D,
  y: number,
  len: number,
  rise: number,
  col: string,
): void {
  const x = POST[0];
  const d = Math.sign(len) || 1;
  const n = Math.max(6, Math.abs(len));
  const tip = x + d * n;
  const neck = x + d * Math.max(2, n - 6);
  const at = (px: number): number => y - (rise * (px - x)) / (d * n);
  g.beginPath();
  g.moveTo(x - d * 4, y - 4);
  g.lineTo(neck, at(neck) - 4);
  g.lineTo(tip, at(tip));
  g.lineTo(neck, at(neck) + 4);
  g.lineTo(x - d * 4, y + 4);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 1.1;
  g.lineJoin = "round";
  g.stroke();
  g.strokeStyle = "rgba(48,38,28,.4)";
  g.lineWidth = 0.6;
  seg(g, x + d * 3, y + 1 - (rise * 3) / n, neck - d, at(neck) + 1);
  g.stroke();
}

export const gatehouse: BuildingSpec = {
  door: { kind: "leaf", w: 34, h: 58, arch: true },
  footprint: {
    w: 184,
    depth: 72,
    ground: [-197, -112, 187, 37],
    upper: [-112, -301, 141, -112],
  },
  setting: ["square", "lane"],
  signX: -206,
  lights: [
    [-63, -60, 14],
    [63, -60, 14],
    [0, -30, 16],
    [32, -76, 14],
    [0, -145, 24],
    [0, -203, 8],
  ],
  chimney: { x: 82, y: -216, phase: 2.1 },
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const A = accent(s.hue);
    const PAINTED = mix(A, "#6e5a44", 0.4);
    const OAK = "#5f4b37";
    castShadow(
      g,
      [
        [L + 6, 4],
        [R + 6, 4],
        [R + 62, 20],
        [R + 78, -30],
        [R + D + 4, -oblique.rise(D) - 4],
      ],
      0.3,
    );
    // the gate: a stone wing with a carriage arch you can see through, under its own slates
    {
      const WL = -172;
      const WT = -84;
      const AX = -137;
      const wingRoof: Pt[] = [
        [WL - 7, WT - 1],
        [L + 4, WT - 1],
        [L + 22, WT - 27],
        [WL + 11, WT - 27],
      ];
      shingles(g, wingRoof, r, { base: "#686b70", rowH: 6.5, w: 9 });
      stones(g, WL, WT, L + 2, 0, r, { rowH: 9 });
      const arch = () => {
        g.beginPath();
        g.moveTo(AX - 23, 0);
        g.lineTo(AX - 23, -41);
        g.arc(AX, -41, 23, Math.PI, 0);
        g.lineTo(AX + 23, 0);
        g.closePath();
      };
      arch();
      const through = g.createLinearGradient(0, -64, 0, 0);
      through.addColorStop(0, "#24201c");
      through.addColorStop(1, "#4a4638");
      g.fillStyle = through;
      g.fill();
      g.save();
      arch();
      g.clip();
      // the lane beyond, and the daylight at its far end
      g.fillStyle = lit ? "rgba(70,78,96,.5)" : "rgba(176,184,142,.5)";
      g.beginPath();
      g.moveTo(AX - 9, -16);
      g.lineTo(AX - 9, -40);
      g.arc(AX + 2, -40, 11, Math.PI, 0);
      g.lineTo(AX + 13, -16);
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(150,144,104,.5)";
      poly(g, [
        [AX - 23, 0],
        [AX + 23, 0],
        [AX + 13, -16],
        [AX - 9, -16],
      ]);
      g.fill();
      // the gate leaf, swung back against the pier
      oblique.fill(g, oblique.sideFace(AX - 23, 0, -52, 10), (leaf) => {
        g.fillStyle = PAINTED;
        poly(g, leaf);
        g.fill();
        ink(g, 1, 0.8);
        g.stroke();
      });
      g.restore();
      arch();
      bar(g, 4.5, "#bdb6a4", null);
      wash(
        g,
        () => {
          g.beginPath();
          g.rect(WL - 3, WT - 4, L - WL + 5, 6);
        },
        [WL - 3, WT - 4, L + 2, WT + 2],
        "#a9a290",
        r,
        { blob: 4, shadeA: 0.2, lw: 1.2 },
      );
      polyKit.ao(g, WL, L, 0);
      ivy(g, WL + 6, 0, -66, r, 16);
      moss(g, WL, L, 1, r, 8);
    }
    // the side wall, receding
    const side = oblique.sideFace(R, 0, EAVE, D);
    // its courses and its window, painted flat in side-face space
    oblique.onSide(g, R, () => {
      stones(g, 0, EAVE, D, 0, r, { rowH: 9, outline: false });
      windowRect(g, 8, -42, 13, 32, r, {
        lit,
        frame: "#4a3a2c",
        sill: "#b3ab98",
      });
    });
    oblique.shadeFace(g, side, 0.34);
    oblique.fill(g, side, (pts) => polyKit.hatch(g, pts, r, 3.5, 0.18));
    oblique.inkFace(g, side, 1.3);
    // the roof plane that shows, and the stack standing on it
    const slope = oblique.extrude([R + 9, EAVE + 4], [0, APEX - 7], D);
    recedingSlates(g, slope, r);
    oblique.shadeFace(g, slope, 0.2);
    const ridgeEnd = oblique.back([0, APEX - 7], D);
    seg(g, 0, APEX - 7, ridgeEnd[0], ridgeEnd[1]);
    bar(g, 4, "#55585d", "rgba(230,236,240,.2)");
    const stack: Pt[] = [
      [68, -208],
      [86, -208],
      [86, -154.5],
      [68, -176],
    ];
    polyKit.stones(g, stack, r, undefined, 7);
    poly(g, stack);
    polyKit.ink(g, 1.2);
    // the stack stands on a plane that keeps its height going back: its side's foot recedes like its top
    const stackSide = oblique.sideFace(86, -154.5, -208, 9);
    oblique.fill(g, stackSide, (pts) =>
      polyKit.stones(g, pts, r, undefined, 7),
    );
    oblique.shadeFace(g, stackSide, 0.4);
    oblique.inkFace(g, stackSide, 1.1);
    oblique.fill(g, oblique.topFace(65, 89, -208, 9), (cap) =>
      wash(g, () => poly(g, cap), bbox(cap), "#8f897b", r, {
        blob: 4,
        shadeA: 0.2,
        lw: 1.2,
      }),
    );
    g.fillStyle = "#2c2824";
    g.beginPath();
    g.ellipse(82, -211.5, 6, 2, 0, 0, TAU);
    g.fill();
    // the front: coursed stone below the jetty
    stones(g, L, -100, R, 0, r, { rowH: 9 });
    g.save();
    g.beginPath();
    g.rect(L, -100, R - L, 100);
    g.clip();
    streaks(g, r, [L, -100, R, 0], 9, "60,54,44", 0.12, 60);
    g.restore();
    polyKit.ao(g, L, R, 0);
    // the gable: lime plaster in an oak frame
    const gable: Pt[] = [
      [L, -100],
      [R, -100],
      [R, EAVE],
      [0, APEX],
      [L, EAVE],
    ];
    wash(g, () => poly(g, gable), bbox(gable), "#cdc3a8", r, {
      blob: 11,
      var: 20,
      shadeA: 0.2,
      lw: 1.3,
    });
    g.save();
    poly(g, gable);
    g.clip();
    streaks(g, r, [L, APEX, R, -100], 12, "90,78,56", 0.12, 46);
    g.fillStyle = "rgba(30,24,16,.24)";
    poly(g, [
      [L, EAVE],
      [0, APEX],
      [R, EAVE],
      [R, EAVE + 13],
      [0, APEX + 15],
      [L, EAVE + 13],
    ]);
    g.fill();
    for (const x of [-68, -46, 46, 68]) {
      seg(g, x, -100, x, gableY(x));
      bar(g, 4.5, OAK, null);
    }
    seg(g, -52, -160, 52, -160);
    bar(g, 4.5, OAK, null);
    for (const d of [-1, 1]) {
      seg(g, d * 68, -130, d * 94, -104);
      bar(g, 4, OAK, null);
    }
    g.restore();
    // the jetty beam, on its bracket ends
    wash(
      g,
      () => {
        g.beginPath();
        g.rect(L - 4, -104, R - L + 8, 9);
      },
      [L - 4, -104, R + 4, -95],
      OAK,
      r,
      {
        blob: 5,
        var: 16,
        shadeA: 0.25,
        lw: 1.3,
      },
    );
    for (let x = L + 8; x < R; x += 22) {
      g.fillStyle = dark(OAK, 0.25);
      g.fillRect(x - 3, -95, 6, 4.5);
      ink(g, 0.8, 0.7);
      g.strokeRect(x - 3, -95, 6, 4.5);
    }
    g.fillStyle = "rgba(30,24,16,.26)";
    g.fillRect(L, -90.5, R - L, 6);
    // bargeboards, in the app's paint, long weathered
    const barge: Pt[] = [
      [L - 9, EAVE + 4],
      [0, APEX - 7],
      [R + 9, EAVE + 4],
      [R + 9, EAVE + 13],
      [0, APEX + 3],
      [L - 9, EAVE + 13],
    ];
    wash(g, () => poly(g, barge), bbox(barge), PAINTED, r, {
      blob: 6,
      var: 26,
      shadeA: 0.24,
      lw: 1.4,
    });
    ink(g, 0.7, 0.5);
    hline(g, 0, APEX - 7, 0, APEX + 3, r, 0.2);
    // the bell-cote astride the ridge (its bell is hung live)
    g.fillStyle = OAK;
    g.fillRect(-13, APEX - 12, 26, 6);
    ink(g, 1);
    g.strokeRect(-13, APEX - 12, 26, 6);
    for (const x of [-10, 10]) {
      seg(g, x, APEX - 12, x, APEX - 36);
      bar(g, 3, OAK, null);
    }
    const cote = oblique.hipRoof({
      x0: -15,
      x1: 15,
      y: APEX - 36,
      d: 8,
      rise: 19,
    });
    oblique.fill(g, cote.side, (pts) =>
      shingles(g, pts, r, { base: "#55585d", rowH: 5, w: 7 }),
    );
    oblique.fill(g, cote.front, (pts) =>
      shingles(g, pts, r, { base: "#686b70", rowH: 5, w: 7 }),
    );
    disc(g, cote.apex[0], cote.apex[1] - 2, 2.4);
    g.fillStyle = BRASS;
    g.fill();
    ink(g, 0.9);
    g.stroke();
    // ground floor: the door between two windows
    for (const x of [-76, 50])
      windowRect(g, x, -42, 26, 36, r, {
        lit,
        frame: "#4a3a2c",
        sill: "#b3ab98",
      });
    doorArch(g, 0, 0, 34, 58, r, { col: mix(A, "#5e4a36", 0.35) });
    ink(g, 0.9, 0.7);
    hline(g, 0, -56, 0, 0, r, 0.2);
    steps(g, 0, 2, 40, 2, r);
    // the attic light
    porthole(g, 0, -203, 6, lit);
    // the signboard's case: a dark boarded back, an iron frame, a little lead hood
    g.fillStyle = "rgba(24,20,14,.3)";
    g.fillRect(-32, -176, 70, 70);
    g.fillStyle = "#2f2a25";
    g.fillRect(-35, -180, 70, 70);
    ink(g, 1.3);
    g.strokeRect(-35, -180, 70, 70);
    g.strokeStyle = IRON;
    g.lineWidth = 2;
    g.strokeRect(-33.2, -178.2, 66.4, 66.4);
    for (const [x, y] of [
      [-34, -179],
      [32, -179],
      [-34, -113],
      [32, -113],
    ] as const)
      rivet(g, x, y, 1.2);
    const hood: Pt[] = [
      [-39, -180],
      [39, -180],
      [43, -185],
      [-35, -185],
    ];
    wash(g, () => poly(g, hood), bbox(hood), "#7f858a", r, {
      blob: 4,
      shadeA: 0.2,
      lw: 1.2,
    });
    // the lantern's bracket, off the jetty beam
    g.beginPath();
    g.moveTo(22, -99);
    g.lineTo(LAMP[0] + 3, -99);
    g.moveTo(22, -88);
    g.quadraticCurveTo(29, -90, LAMP[0], -99);
    bar(g, 1.6, IRON, null);
    // the fingerpost: its shadow, the post, the arms that stay put
    ellShadow(g, POST[0] + 8, POST[1] + 2, 16, 4, 0.24);
    wash(
      g,
      () => {
        g.beginPath();
        g.rect(POST[0] - 3, POST[1] - POST_H, 6, POST_H);
      },
      [POST[0] - 3, POST[1] - POST_H, POST[0] + 3, POST[1]],
      "#8a7558",
      r,
      { blob: 3, var: 18, shadeA: 0.3, lw: 1.2 },
    );
    arm(g, POST[1] - 34, -27, 3, "#b9ae93");
    arm(g, POST[1] - 46, 30, -2, "#c4b99d");
    arm(g, POST[1] - 57, -18, -6, "#aea389");
    disc(g, POST[0], POST[1] - POST_H - 3, 3.4);
    g.fillStyle = BRASS;
    g.fill();
    ink(g, 1);
    g.stroke();
    for (const [x, y, n] of [
      [POST[0] - 7, POST[1] + 1, 4],
      [POST[0] + 6, POST[1] + 3, 3],
    ] as const) {
      g.fillStyle = "#8d8a80";
      g.beginPath();
      g.ellipse(x, y, n, n * 0.6, 0, 0, TAU);
      g.fill();
      ink(g, 0.8, 0.7);
      g.stroke();
    }
    // what grows and stands about
    barrel(g, -90, 8, 8, r);
    ivy(g, L + 5, 0, -92, r, 20);
    ivy(g, R - 6, 0, -50, r, 12);
    moss(g, L, R, 1, r, 16);
    tufts(g, L - 76, R + 30, 4, r, 34);
    tufts(g, POST[0] - 14, POST[0] + 16, POST[1] + 2, r, 6);
    for (const [x, y, z, k] of [
      [-182, 4, 11, 0],
      [120, -8, 12, 1],
      [58, 24, 7, 2],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    const dim = s.night || s.dusk;
    // the bell in the cote swings once for every tile that turns
    {
      const c = t % TURN_EVERY;
      const a = 0.4 * Math.exp(-1.3 * c) * Math.sin(c * 6.5);
      g.save();
      g.translate(0, APEX - 34);
      g.rotate(a);
      g.beginPath();
      g.moveTo(-2, 1);
      g.quadraticCurveTo(-3, 8, -6.5, 13);
      g.lineTo(6.5, 13);
      g.quadraticCurveTo(3, 8, 2, 1);
      g.closePath();
      g.fillStyle = BRASS;
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 1;
      g.lineJoin = "round";
      g.stroke();
      disc(g, 0, 14.5, 1.6);
      g.fillStyle = IRON;
      g.fill();
      g.restore();
    }
    // the signboard: one tile at a time turns over on its pivot and shows another face
    {
      const n = Math.floor(t / TURN_EVERY);
      const u = clamp01((t - n * TURN_EVERY) / TURN_TAKES);
      const turning = TURNS[n % 9]!;
      for (let i = 0; i < 9; i++) {
        const at = TURNS.indexOf(i as (typeof TURNS)[number]);
        // how many times it has turned so far
        const done = Math.floor((n + 8 - at) / 9);
        const mine = i === turning;
        const face = done + (mine && u >= 0.5 ? 1 : 0);
        const col = ENAMEL[(i * 4 + face * 3) % ENAMEL.length]!;
        const k = mine ? Math.abs(Math.cos(Math.PI * ease(u))) : 1;
        const cx = GRID[0] + (i % 3) * PITCH + PITCH / 2;
        const cy = GRID[1] + Math.floor(i / 3) * PITCH + PITCH / 2;
        const w = Math.max(1.6, TILE * k);
        const tile = () => {
          g.beginPath();
          g.roundRect(cx - w / 2, cy - TILE / 2, w, TILE, Math.min(4, w / 2));
        };
        tile();
        g.fillStyle = col;
        g.fill();
        g.save();
        g.clip();
        // the glaze: worn at the foot, a light along the top
        g.fillStyle = `rgba(30,22,14,${0.1 + ((i * 7) % 5) * 0.035})`;
        g.fillRect(cx - w / 2, cy + TILE / 2 - 6, w, 6);
        g.fillStyle = "rgba(255,246,220,.26)";
        g.fillRect(cx - w / 2, cy - TILE / 2, w, 2.2);
        g.restore();
        // its device, in pale slip: a disc, a ring, a lozenge, two bars
        g.fillStyle = g.strokeStyle = light(col, 0.42);
        g.lineWidth = 1.6;
        const d = (i + face) % 4;
        g.beginPath();
        if (d === 0) g.ellipse(cx, cy, 4 * k, 4, 0, 0, TAU);
        else if (d === 1) g.ellipse(cx, cy, 4.4 * k, 4.4, 0, 0, TAU);
        else if (d === 2) {
          g.moveTo(cx, cy - 5);
          g.lineTo(cx + 5 * k, cy);
          g.lineTo(cx, cy + 5);
          g.lineTo(cx - 5 * k, cy);
          g.closePath();
        } else {
          g.rect(cx - 4.5 * k, cy - 4, 9 * k, 2.6);
          g.rect(cx - 4.5 * k, cy + 1.4, 9 * k, 2.6);
        }
        if (d === 1) g.stroke();
        else g.fill();
        tile();
        g.strokeStyle = INK;
        g.lineWidth = 0.9;
        g.stroke();
        if (mine && dim) {
          // the tile just turned stays lamp-lit a while
          const a =
            clamp01(u * 2) * clamp01((TURN_EVERY - (t - n * TURN_EVERY)) / 1.2);
          g.save();
          g.globalCompositeOperation = "lighter";
          g.fillStyle = `rgba(255,214,140,${0.34 * a})`;
          tile();
          g.fill();
          g.restore();
        }
      }
    }
    // the top arm of the fingerpost swings round to point a new way, overshoots, settles
    {
      const n = Math.floor(t / WAY_EVERY);
      const c = t - n * WAY_EVERY;
      const from = WAYS[n % WAYS.length]!;
      const to = WAYS[(n + 1) % WAYS.length]!;
      const u = ease(clamp01((c - (WAY_EVERY - 1.8)) / 1.8));
      const th =
        from + (to - from) * u + 0.16 * Math.exp(-2.6 * c) * Math.sin(c * 8);
      arm(g, POST[1] - 68, 31 * Math.cos(th), 9 * Math.sin(th), "#cfc4a6");
      g.fillStyle = IRON;
      g.fillRect(POST[0] - 3.6, POST[1] - 71.5, 7.2, 7);
    }
    // the welcome lantern on its chain: it sways, burns from dusk (its moths are `ambient`)
    {
      const a = 0.05 * Math.sin(t * 1.25) + 0.05 * (gust(t, 1.3) - 0.5);
      const f = 0.75 + 0.15 * Math.sin(t * 7.3) + 0.1 * Math.sin(t * 12.1 + 1);
      g.save();
      g.translate(LAMP[0], LAMP[1] - 7);
      g.rotate(a);
      g.strokeStyle = INK;
      g.lineWidth = 1;
      seg(g, 0, 0, 0, 7);
      g.stroke();
      g.fillStyle = dim ? "#ffd98a" : "#c9c2a8";
      g.fillRect(-4.5, 9, 9, 13);
      if (dim) {
        g.fillStyle = `rgba(255,246,206,${0.6 * f})`;
        g.beginPath();
        g.ellipse(0, 16.5, 1.8, 3.6, 0, 0, TAU);
        g.fill();
      }
      g.strokeStyle = INK;
      g.lineWidth = 0.9;
      g.strokeRect(-4.5, 9, 9, 13);
      seg(g, 0, 9, 0, 22);
      g.stroke();
      g.fillStyle = IRON;
      g.beginPath();
      g.moveTo(-6.5, 9);
      g.lineTo(0, 4.5);
      g.lineTo(6.5, 9);
      g.closePath();
      g.fill();
      g.fillRect(-5.5, 22, 11, 2.2);
      if (dim) {
        g.globalCompositeOperation = "lighter";
        const gl = g.createRadialGradient(0, 16, 1, 0, 16, 26);
        gl.addColorStop(0, `rgba(255,210,130,${0.4 * f})`);
        gl.addColorStop(1, "rgba(255,210,130,0)");
        g.fillStyle = gl;
        g.fillRect(-26, -10, 52, 52);
      }
      g.restore();
    }
    // someone is in
    glowPane(g, s, -74, -76, 22, 32, 0.6);
    glowPane(g, s, 52, -76, 22, 32, 2.9);
  },
  // the two moths the welcome lantern draws at night: never part of its shape
  ambient(g, s) {
    const t = s.t;
    if (s.night)
      for (const ph of [0, 2.4]) {
        const q = t * 1.7 + ph;
        const mx = LAMP[0] + Math.cos(q) * (9 + 3 * Math.sin(q * 0.6 + ph));
        const my = LAMP[1] + 9 + Math.sin(q * 1.3 + ph) * 8;
        const flap = 2.2 * Math.abs(Math.sin(t * 17 + ph));
        g.strokeStyle = "rgba(236,228,206,.9)";
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(mx - 2.4, my - flap);
        g.lineTo(mx, my);
        g.lineTo(mx + 2.4, my - flap);
        g.stroke();
      }
  },
};
