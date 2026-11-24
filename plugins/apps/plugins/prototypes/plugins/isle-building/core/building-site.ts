// Prototypes' building on Isle: a house being built — a half-timbered house
// mid-construction. A weathered oak frame with pegged joints on a stone
// footing; one bay already walled in pale blockwork, the next in wattle and
// plaster, the rest still open; one end of the roof shingled, the rest bare
// rafters and battens; a blueprint on linen pinned over the doorway with the
// door drawn on it as a dashed arch; scaffolding lashed with rope, a ladder, a
// timber stack, a sawhorse and a mortar tub — and beside it a big wooden crane,
// a braced oak mast with a long jib and a treadwheel at its foot. It is the
// app at work, an idea taking shape: the crane lifts timber off the stack,
// slews it over the frame and sets it down, its treadwheel turning; the
// next shingles are laid course by course, lines are added to the blueprint
// while its corner lifts in the wind, a builder hammers on the scaffold, and
// the plumb line swings.

import {
  accent,
  bbox,
  castShadow,
  fittings,
  grain,
  hline,
  ink,
  jit,
  moss,
  oblique,
  planks,
  poly,
  shingles,
  shrub,
  stones,
  tufts,
  wash,
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
  clamp01,
  ease,
  disc,
  seg,
  ellShadow,
  bar,
  streaks,
  rockLump,
  gust,
  glowPane,
  lengthOf,
  partial,
} = fittings;

const GRAIN_BOX: Box = [-230, -380, 300, 70];
const OAK = "#8a7253";
const OAK_D = "#6e573f";
const OAK_HI = "rgba(255,240,210,.22)";
const POLE = "#96805e";
/** The front wall: its left and right ends, the wall plate's y, the mid rail's and the sill's. */
const L = -110;
const R = 110;
const PLATE = -100;
const RAIL = -52;
const SILL = -9;
/** How deep the frame is, and where its back stands on screen: shared by the wall, the eave and the roof. */
const D = 30;
const SIDE: Pt = oblique.back([0, 0], D);
/** The roof: a gable along the front, its ridge half the depth back. */
const ROOF = oblique.gableRoof({
  x0: L - 8,
  x1: R + 8,
  y: PLATE,
  d: D,
  rise: 61.5,
});
const RIDGE_Y = ROOF.ridge[0][1];
const RIDGE_DX = ROOF.ridge[0][0] - (L - 8);
/** A point of the front roof slope: `x` along the eave, `u` of the way up (0 eave, 1 ridge). */
const slope = (x: number, u: number): Pt => [
  x + RIDGE_DX * u,
  PLATE + (RIDGE_Y - PLATE) * u,
];
const POSTS = [L, -62, -20, 20, 62, R] as const;
/** The eave x where the laid shingles stop, and where the courses being laid stop. */
const LAID_X = -40;
const LAYING_X = 30;
const COURSES = 10;
const TILE = ["#7c6a58", "#6f5f50", "#877563", "#75685a"] as const;
/** The scaffold (left): its two poles' x, and the platform's y. */
const POLE_X = [-176, -130] as const;
const DECK = -62;
/**
 * The crane (right): the mast's x, its head's y and the y the jib is stepped
 * at; the treadwheel's hub and radius; the jib's tip over the timber stack and
 * over the frame; how low the hook goes at each, and how high it travels.
 */
const MAST_X = 200;
const MAST_TOP = -306;
const JIB_FOOT = -206;
const WHEEL: Pt = [242, -40];
const WHEEL_R = 35;
/** How deep the treadwheel is, and its far rim's hub. */
const WHEEL_D = 9;
const WHEEL_BACK: Pt = oblique.back(WHEEL, WHEEL_D);
const TIP_STACK: Pt = [122, -322];
const TIP_FRAME: Pt = [36, -344];
const HOOK_STACK = 12;
const HOOK_FRAME = -150;
const HOOK_HIGH = -214;
/** The crane's round: [until (s), slew (0 stack..1 frame), hook y, loaded] — eased from one to the next. */
const ROUND = [
  [0, 0, HOOK_STACK, 1],
  [2, 0, HOOK_STACK, 1],
  [9, 0, HOOK_HIGH, 1],
  [15, 1, HOOK_HIGH, 1],
  [18.5, 1, HOOK_FRAME, 1],
  [20, 1, HOOK_FRAME, 0],
  [22, 1, HOOK_HIGH, 0],
  [27, 0, HOOK_HIGH, 0],
  [31, 0, HOOK_STACK, 0],
  [32, 0, HOOK_STACK, 1],
] as const;
const ROUND_S = 32;
/** The blueprint over the doorway: its box, and the corner the wind lifts. */
const SHEET = [-19, -78, 19, -4] as const;
const FLAP = 15;
/** What is drawn on it after the door, line by line. */
const PLAN: readonly (readonly Pt[])[] = [
  [
    [-14, -72],
    [14, -72],
  ],
  [
    [-14, -74.5],
    [-14, -69.5],
  ],
  [
    [14, -74.5],
    [14, -69.5],
  ],
  [
    [16.5, -56],
    [16.5, -6],
  ],
  [
    [15, -56],
    [18, -56],
  ],
  [
    [15, -6],
    [18, -6],
  ],
  [
    [6, -31],
    [10, -31],
    [10, -27],
    [6, -27],
    [6, -31],
  ],
  [
    [-13, -20],
    [-9, -20],
  ],
  [
    [-13, -44],
    [-9, -44],
  ],
  [
    [-8, -64],
    [8, -64],
  ],
];
const PLAN_LEN = PLAN.map(lengthOf);
const PLAN_TOTAL = PLAN_LEN.reduce((a, b) => a + b, 0);

/** The door to come, drawn on the blueprint: its half width, its foot, where its arch springs. */
const DRAWN = { r: 13, foot: -6, spring: -45 } as const;

/** The dashed arch of the door to come, on the blueprint. */
function doorOutline(g: Ctx2D): void {
  g.beginPath();
  g.moveTo(-DRAWN.r, DRAWN.foot);
  g.lineTo(-DRAWN.r, DRAWN.spring);
  g.arc(0, DRAWN.spring, DRAWN.r, Math.PI, 0);
  g.lineTo(DRAWN.r, DRAWN.foot);
}

export const buildingSite: BuildingSpec = {
  // the door drawn on the blueprint is the door: it opens on a lit room
  door: {
    kind: "leaf",
    w: 2 * DRAWN.r,
    h: DRAWN.foot - DRAWN.spring + DRAWN.r,
    head: DRAWN.r,
    y: DRAWN.foot,
  },
  footprint: {
    w: 230,
    depth: 80,
    ground: [-211, -112, 295, 63],
    upper: [-197, -351, 241, -112],
  },
  setting: ["forest"],
  signX: -150,
  lights: [
    [-86, -52, 14],
    [0, -34, 14],
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    castShadow(
      g,
      [
        [-104, 4],
        [112, 4],
        [133, 10],
        [146, -16],
        [140, -22],
      ],
      0.26,
    );
    // the inside of the frame, seen through the open bays and the bare rafters
    const front: Pt[] = [
      [L, PLATE],
      [R, PLATE],
      [R, 0],
      [L, 0],
    ];
    const side = oblique.sideFace(R, 0, PLATE, D);
    const roof = ROOF.slope;
    g.fillStyle = "#39322a";
    poly(g, front);
    g.fill();
    oblique.fill(g, side, (pts) => {
      g.fillStyle = "#2f2a24";
      poly(g, pts);
      g.fill();
    });
    g.fillStyle = "#3b332a";
    poly(g, roof);
    g.fill();
    g.save();
    poly(g, front);
    g.clip();
    const fl = g.createLinearGradient(0, PLATE, 0, 0);
    fl.addColorStop(0, "rgba(16,12,8,.45)");
    fl.addColorStop(1, lit ? "rgba(255,200,110,.22)" : "rgba(150,128,92,.3)");
    g.fillStyle = fl;
    g.fillRect(L, PLATE, R - L, -PLATE);
    // the back wall's frame, dim
    g.strokeStyle = "rgba(150,126,92,.3)";
    g.lineWidth = 4;
    for (const x of POSTS) {
      seg(g, x + SIDE[0], SIDE[1], x + SIDE[0], PLATE);
      g.stroke();
    }
    seg(g, L, RAIL + SIDE[1], R + SIDE[0], RAIL + SIDE[1]);
    g.stroke();
    seg(g, L, SIDE[1] + 2, R + SIDE[0], SIDE[1] + 2);
    g.stroke();
    g.restore();
    // the roof: battens and rafters, the ridge beam, and the end already shingled
    g.save();
    poly(g, roof);
    g.clip();
    const rl = g.createLinearGradient(0, RIDGE_Y, 0, PLATE);
    rl.addColorStop(0, "rgba(16,12,8,.5)");
    rl.addColorStop(1, lit ? "rgba(255,200,110,.2)" : "rgba(130,108,76,.25)");
    g.fillStyle = rl;
    g.fillRect(L - 10, RIDGE_Y, R - L + 40, PLATE - RIDGE_Y);
    g.restore();
    for (let u = 0.16; u < 1; u += 0.2) {
      const a = slope(L - 8, u);
      const b = slope(R + 8, u);
      seg(g, a[0], a[1], b[0], b[1]);
      bar(g, 2, "#7d6648", null);
    }
    for (let x = L; x <= R; x += 22) {
      const a = slope(x, 0);
      const b = slope(x, 1);
      seg(g, a[0], a[1], b[0], b[1]);
      bar(g, 3.6, OAK, OAK_HI);
    }
    shingles(
      g,
      [
        slope(L - 8, -0.03),
        slope(LAID_X, -0.03),
        slope(LAID_X, 1),
        slope(L - 8, 1),
      ],
      r,
      { base: "#7c6a58", rowH: 7, w: 10 },
    );
    {
      const a = slope(L - 10, 1);
      const b = slope(R + 10, 1);
      seg(g, a[0], a[1], b[0], b[1]);
      bar(g, 4.4, OAK_D, OAK_HI);
    }
    // the far gable's rafter, and the side wall's frame receding
    {
      const top = slope(R + 8, 1);
      seg(g, top[0], top[1], R + 8 + SIDE[0], PLATE + SIDE[1]);
      bar(g, 3.6, OAK_D, null);
    }
    for (const [x0, y0, x1, y1, w] of [
      [R + SIDE[0], SIDE[1] - 3, R + SIDE[0], PLATE + SIDE[1], 4.5],
      [R, PLATE, R + SIDE[0], PLATE + SIDE[1], 4.5],
      [R, RAIL, R + SIDE[0], RAIL + SIDE[1], 3.6],
      [R, SILL, R + SIDE[0], SILL + SIDE[1], 4.5],
      [R + 4, SILL - 4, R + 26, RAIL - 16, 3],
    ] as const) {
      seg(g, x0, y0, x1, y1);
      bar(g, w, OAK_D, null);
    }
    // the bays already walled: pale blockwork, then wattle above plaster
    stones(g, L + 2, PLATE + 3, -64, SILL + 2, r, {
      rowH: 9,
      blockW: 20,
      base: "#c4bca8",
      outline: false,
    });
    windowRect(g, -97, -36, 22, 34, r, {
      lit,
      frame: "#5d4a35",
      sill: "#a49d8c",
    });
    wash(
      g,
      () => {
        g.beginPath();
        g.rect(-60, RAIL + 2, 38, SILL - RAIL);
      },
      [-60, RAIL + 2, -22, SILL + 2],
      "#d8cdb2",
      r,
      { blob: 8, var: 18, outline: false },
    );
    g.fillStyle = "#6f5b3e";
    g.fillRect(-60, PLATE + 3, 38, RAIL - PLATE - 5);
    ink(g, 0.7, 0.5);
    for (let x = -57; x < -22; x += 5)
      hline(g, x, PLATE + 3, x, RAIL - 2, r, 0.5);
    g.strokeStyle = "rgba(196,170,120,.55)";
    g.lineWidth = 1.2;
    for (let y = PLATE + 8; y < RAIL - 2; y += 5) {
      g.beginPath();
      g.moveTo(-60, y);
      for (let x = -55; x <= -22; x += 5)
        g.lineTo(x, y + (((x + y) / 5) % 2 ? 1.2 : -1.2));
      g.stroke();
    }
    // the oak frame on its stone footing: sill, rail, plate, posts, braces, pegs
    stones(g, L - 3, -7, R + 3, 0, r, { rowH: 7, blockW: 16, base: "#a59d8b" });
    for (const [x0, y0, x1, y1, w] of [
      [L, SILL, R, SILL, 5],
      [L, RAIL, -20, RAIL, 4],
      [20, RAIL, R, RAIL, 4],
      [-20, -82, 20, -82, 4.4],
      [24, -74, 46, PLATE + 3, 3.4],
      [106, -74, 84, PLATE + 3, 3.4],
      [66, SILL - 3, 88, RAIL + 3, 3.4],
      [58, SILL - 3, 36, RAIL + 3, 3.4],
    ] as const) {
      seg(g, x0, y0, x1, y1);
      bar(g, w, OAK, OAK_HI);
    }
    for (const x of POSTS) {
      seg(g, x, SILL, x, PLATE);
      bar(g, 5.4, OAK, OAK_HI);
    }
    seg(g, L - 5, PLATE, R + 5, PLATE);
    bar(g, 6, OAK_D, OAK_HI);
    g.fillStyle = "#33281e";
    for (const x of POSTS)
      for (const y of [SILL, RAIL, PLATE]) {
        g.fillRect(x - 1.8, y - 0.9, 1.6, 1.6);
        g.fillRect(x + 0.4, y - 0.9, 1.6, 1.6);
      }
    g.save();
    poly(g, front);
    g.clip();
    streaks(g, r, [L, PLATE, R, 0], 10, "40,32,22", 0.1, 40);
    g.restore();
    // the blueprint on linen over the doorway (its corner lifts in the wind): the door, drawn
    const sheet: Pt[] = [
      [SHEET[0], SHEET[1]],
      [SHEET[2], SHEET[1]],
      [SHEET[2], SHEET[3] - FLAP],
      [SHEET[2] - FLAP, SHEET[3]],
      [SHEET[0], SHEET[3]],
    ];
    wash(g, () => poly(g, sheet), bbox(sheet), "#52687e", r, {
      blob: 5,
      var: 16,
      shadeA: 0.18,
      lw: 1.2,
    });
    g.save();
    g.strokeStyle = "rgba(232,238,240,.85)";
    g.lineWidth = 1.1;
    g.setLineDash([3.2, 2.6]);
    doorOutline(g);
    g.stroke();
    g.setLineDash([]);
    g.restore();
    g.fillStyle = BRASS;
    for (const x of [SHEET[0] + 2.5, SHEET[2] - 2.5]) {
      disc(g, x, SHEET[1] + 2.5, 1.4);
      g.fill();
    }
    // the scaffold: poles, ledgers and a brace lashed with rope, a plank deck
    ellShadow(g, -150, 24, 34, 5, 0.24);
    seg(g, POLE_X[0] + 4, 20, POLE_X[1] - 4, DECK + 4);
    bar(g, 2.2, POLE, null);
    for (const y of [DECK + 4, -130]) {
      seg(g, POLE_X[0] - 8, y, POLE_X[1] + 22, y);
      bar(g, 2.6, POLE, null);
    }
    seg(g, POLE_X[0], 24, POLE_X[0], -146);
    bar(g, 3.2, POLE, OAK_HI);
    seg(g, POLE_X[1], 20, POLE_X[1], -152);
    bar(g, 3.2, POLE, OAK_HI);
    planks(g, POLE_X[0] - 10, DECK - 1, POLE_X[1] + 18, DECK + 4, r, {
      base: "#a08a66",
      vertical: false,
      pw: 5,
    });
    g.strokeStyle = "#cdb98c";
    g.lineWidth = 1.1;
    for (const x of POLE_X)
      for (const y of [DECK + 4, -130]) {
        seg(g, x - 3, y - 3, x + 3, y + 3);
        g.stroke();
        seg(g, x - 3, y + 3, x + 3, y - 3);
        g.stroke();
        seg(g, x - 3.4, y, x + 3.4, y);
        g.stroke();
      }
    // the ladder against the blockwork
    ellShadow(g, -78, 16, 14, 3, 0.24);
    ink(g, 1, 0.75);
    g.strokeStyle = "#7d6648";
    g.lineWidth = 1.8;
    for (let k = 1; k < 10; k++) {
      const u = k / 10;
      seg(g, -94 + 13 * u, 14 - 118 * u, -78 + 13 * u, 14 - 118 * u);
      g.stroke();
    }
    for (const x of [-94, -78]) {
      seg(g, x, 14, x + 13, -104);
      bar(g, 2.4, "#a08a66", null);
    }
    // the crane: a braced oak mast on a ballasted cross of sills, the treadwheel at its foot (its jib is animated)
    ellShadow(g, MAST_X + 14, 14, 68, 9, 0.24);
    seg(g, MAST_X - 15, 21, MAST_X + 15, 0);
    bar(g, 6, OAK_D, null);
    seg(g, MAST_X - 46, 10, MAST_X + 82, 10);
    bar(g, 6.4, OAK_D, OAK_HI);
    rockLump(g, MAST_X - 38, 8, 9, r);
    rockLump(g, MAST_X - 12, 20, 7, r);
    seg(g, WHEEL[0], WHEEL[1], WHEEL[0], 8);
    bar(g, 4.4, OAK_D, null);
    seg(g, MAST_X + 15, 0, MAST_X, -96);
    bar(g, 3.4, OAK_D, null);
    for (const x of [MAST_X - 44, MAST_X + 30]) {
      seg(g, x, 8, MAST_X, -124);
      bar(g, 4.2, OAK, OAK_HI);
    }
    seg(g, MAST_X, 8, MAST_X, MAST_TOP);
    bar(g, 10, OAK, OAK_HI);
    g.fillStyle = "#3f3c38";
    for (const y of [-124, JIB_FOOT + 8, MAST_TOP + 12])
      g.fillRect(MAST_X - 6.4, y - 2, 12.8, 4);
    g.fillStyle = "#33281e";
    for (const y of [-60, -150, -180, -250]) {
      g.fillRect(MAST_X - 2, y, 1.6, 1.6);
      g.fillRect(MAST_X + 0.6, y + 5, 1.6, 1.6);
    }
    disc(g, MAST_X, MAST_TOP, 6);
    g.fillStyle = "#4a4640";
    g.fill();
    ink(g, 1);
    g.stroke();
    // the hoisting rope down the mast to the wheel's drum, and the treadwheel's rim
    g.strokeStyle = "rgba(48,38,28,.75)";
    g.lineWidth = 1;
    seg(g, MAST_X + 4, MAST_TOP + 2, WHEEL[0] - 4, WHEEL[1] - 3);
    g.stroke();
    // (a treadwheel is a drum: its far rim stands `WHEEL_D` behind the near one, the treads between them turn in `animate`)
    disc(g, WHEEL_BACK[0], WHEEL_BACK[1], WHEEL_R);
    bar(g, 4.6, OAK_D, null);
    disc(g, WHEEL[0], WHEEL[1], WHEEL_R);
    bar(g, 5.4, OAK, OAK_HI);
    disc(g, WHEEL[0], WHEEL[1], WHEEL_R - 6);
    ink(g, 0.8, 0.6);
    g.stroke();
    // the yard: a timber stack, a sawhorse with a board on it, a mortar tub, two stakes marking the way in
    castShadow(
      g,
      [
        [92, 50],
        [152, 50],
        [158, 54],
        [98, 54],
      ],
      0.25,
    );
    // two tiers of boards: each shows its top and the boards' ends
    for (const [x0, x1, yt, yb, base] of [
      [92, 152, 38, 50, "#a08a66"],
      [98, 146, 30, 38, "#96805e"],
    ] as const)
      oblique.solid(
        g,
        { x0, x1, yb, yt, d: 12 },
        {
          side: (d) => {
            g.fillStyle = "#77633f";
            g.fillRect(0, yt, d, yb - yt);
            g.strokeStyle = "rgba(40,30,20,.5)";
            g.lineWidth = 0.7;
            for (let y = yt + 4; y < yb; y += 4) {
              seg(g, 0, y, d, y);
              g.stroke();
            }
          },
          top: (a, b, d) => {
            g.fillStyle = "#b39c74";
            g.fillRect(a, 0, b - a, d);
            g.strokeStyle = "rgba(40,30,20,.35)";
            g.lineWidth = 0.7;
            for (let v = 4; v < d; v += 4) {
              seg(g, a, v, b, v);
              g.stroke();
            }
          },
          front: () =>
            planks(g, x0, yt, x1, yb, r, { base, vertical: false, pw: 4 }),
          shade: 0.2,
          ink: 1,
        },
      );
    ellShadow(g, 60, 46, 26, 4, 0.24);
    for (const [x0, x1] of [
      [38, 44],
      [48, 42],
      [72, 78],
      [82, 76],
    ] as const) {
      seg(g, x0, 46, x1, 28);
      bar(g, 2.2, OAK_D, null);
    }
    oblique.solid(
      g,
      { x0: 32, x1: 88, yb: 28, yt: 23, d: 7 },
      {
        side: (d, yt, yb) => {
          g.fillStyle = OAK_D;
          g.fillRect(0, yt, d, yb - yt);
        },
        top: (a, b, d) => {
          g.fillStyle = "#a08a66";
          g.fillRect(a, 0, b - a, d);
        },
        front: () =>
          planks(g, 32, 23, 88, 28, r, { base: OAK, vertical: false, pw: 5 }),
        shade: 0.15,
        ink: 0.9,
      },
    );
    const tub: Pt[] = [
      [-62, 28],
      [-30, 28],
      [-34, 42],
      [-58, 42],
    ];
    ellShadow(g, -42, 43, 18, 3, 0.24);
    wash(g, () => poly(g, tub), bbox(tub), "#7b756a", r, {
      blob: 3,
      var: 16,
      shadeA: 0.3,
      lw: 1.2,
    });
    g.fillStyle = "#b9b3a4";
    g.beginPath();
    g.ellipse(-46, 28, 16, 3.4, 0, 0, TAU);
    g.fill();
    ink(g, 0.9, 0.8);
    g.stroke();
    for (const x of [-30, 30]) {
      ellShadow(g, x + 3, 21, 5, 1.6, 0.24);
      g.fillStyle = jit("#b9895a", r, 14);
      poly(g, [
        [x - 3.2, 20],
        [x + 3.2, 20],
        [x + 1.4, 4],
        [x - 1.4, 4],
      ]);
      g.fill();
      ink(g, 0.9, 0.8);
      g.stroke();
      g.fillStyle = "#e4dcc4";
      g.fillRect(x - 2.2, 10, 4.4, 3);
    }
    moss(g, L, R, 0, r, 12);
    tufts(g, L - 4, -24, 3, r, 12);
    tufts(g, 24, R, 3, r, 10);
    tufts(g, -190, -120, 26, r, 8);
    for (const [x, y, z, k] of [
      [-196, 2, 13, 1],
      [-88, 44, 8, 2],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    // the shingles being laid: the next courses go on one by one from the eave up, then the batch is begun again
    {
      const c = t % 24;
      const shown = Math.min(COURSES, Math.floor(c / 1.7));
      const a = c < 21 ? 1 : clamp01((23 - c) / 2);
      g.save();
      // they lie behind the wall plate, as the laid ones do
      g.beginPath();
      g.rect(L - 20, RIDGE_Y - 4, R - L + 80, PLATE - 3 - (RIDGE_Y - 4));
      g.clip();
      g.globalAlpha = a;
      for (let row = 0; row < shown; row++) {
        const u0 = row / COURSES;
        const u1 = (row + 1) / COURSES;
        for (
          let i = 0, x = LAID_X + (row % 2) * 5;
          x < LAYING_X;
          i++, x += 10
        ) {
          const x1 = Math.min(LAYING_X, x + 9.2);
          g.fillStyle = TILE[(i * 3 + row * 5) % TILE.length]!;
          poly(g, [slope(x, u0), slope(x1, u0), slope(x1, u1), slope(x, u1)]);
          g.fill();
        }
        const p = slope(LAID_X, u0);
        const q = slope(LAYING_X, u0);
        seg(g, p[0], p[1], q[0], q[1]);
        g.strokeStyle = "rgba(34,27,20,.6)";
        g.lineWidth = 1.1;
        g.stroke();
      }
      g.restore();
    }
    // the crane at work: a bundle of boards lifted off the stack, slewed over the frame, set down on the rafters, the hook sent back — the treadwheel turning whenever the rope runs (at rest at night)
    {
      const c = s.night ? 0 : t % ROUND_S;
      let k = 1;
      while (k < ROUND.length - 1 && ROUND[k]![0] <= c) k++;
      const from = ROUND[k - 1]!;
      const to = ROUND[k]!;
      const u = ease(clamp01((c - from[0]) / (to[0] - from[0])));
      const slew = from[1] + (to[1] - from[1]) * u;
      const reach = s.night ? HOOK_HIGH : from[2] + (to[2] - from[2]) * u;
      const load = s.night ? 0 : from[3] + (to[3] - from[3]) * u;
      const tx = TIP_STACK[0] + (TIP_FRAME[0] - TIP_STACK[0]) * slew;
      const ty = TIP_STACK[1] + (TIP_FRAME[1] - TIP_STACK[1]) * slew;
      // the wheel: its spokes and treads turn with the rope
      const turn = reach / 15;
      // the treads across the drum, from the near rim to the far one
      g.strokeStyle = "rgba(58,44,30,.9)";
      g.lineWidth = 1.5;
      g.lineCap = "round";
      for (let i = 0; i < 20; i++) {
        const a = turn + (i * TAU) / 20;
        const dx = Math.cos(a) * WHEEL_R;
        const dy = Math.sin(a) * WHEEL_R;
        seg(
          g,
          WHEEL[0] + dx,
          WHEEL[1] + dy,
          WHEEL_BACK[0] + dx,
          WHEEL_BACK[1] + dy,
        );
        g.stroke();
      }
      g.strokeStyle = OAK_D;
      g.lineWidth = 2.6;
      for (let i = 0; i < 10; i++) {
        const a = turn + (i * TAU) / 10;
        seg(
          g,
          WHEEL[0],
          WHEEL[1],
          WHEEL[0] + Math.cos(a) * (WHEEL_R - 3),
          WHEEL[1] + Math.sin(a) * (WHEEL_R - 3),
        );
        g.stroke();
      }
      disc(g, WHEEL[0], WHEEL[1], 5);
      g.fillStyle = "#4a4640";
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 1;
      g.stroke();
      // the jib and its strut, the stay from the mast head, the pulley at the tip
      g.strokeStyle = "rgba(48,38,28,.75)";
      g.lineWidth = 1;
      seg(g, MAST_X, MAST_TOP, tx, ty);
      g.stroke();
      seg(
        g,
        MAST_X,
        JIB_FOOT - 44,
        MAST_X + (tx - MAST_X) * 0.55,
        JIB_FOOT + (ty - JIB_FOOT) * 0.55,
      );
      bar(g, 3.6, OAK_D, null);
      seg(g, MAST_X, JIB_FOOT, tx, ty);
      bar(g, 6.6, OAK, OAK_HI);
      disc(g, tx, ty + 3, 4.4);
      g.fillStyle = "#4a4640";
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 1;
      g.stroke();
      // the rope, the hook, the load
      const sway = Math.sin(t * 1.1) * 2.2 * clamp01((HOOK_STACK - reach) / 60);
      const hx = tx + sway;
      const hy = reach;
      g.strokeStyle = "rgba(48,38,28,.8)";
      g.lineWidth = 1;
      seg(g, tx, ty + 6, hx, hy);
      g.stroke();
      g.strokeStyle = INK;
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(hx, hy + 2.4, 2.4, -0.4, Math.PI);
      g.stroke();
      if (load > 0) {
        g.save();
        g.globalAlpha = load;
        g.strokeStyle = "rgba(48,38,28,.8)";
        g.lineWidth = 0.9;
        seg(g, hx, hy + 4, hx - 16, hy + 14);
        g.stroke();
        seg(g, hx, hy + 4, hx + 16, hy + 14);
        g.stroke();
        for (const [row, col] of [
          [0, "#a08a66"],
          [1, "#96805e"],
          [2, "#a8926c"],
        ] as const) {
          g.fillStyle = col;
          g.fillRect(hx - 23, hy + 14 + row * 4.4, 46, 4.4);
          g.strokeStyle = INK;
          g.lineWidth = 0.9;
          g.strokeRect(hx - 23, hy + 14 + row * 4.4, 46, 4.4);
        }
        g.restore();
      }
    }
    // the blueprint: lines added to the plan one after another, then begun again; its corner lifting in the wind
    {
      const c = t % 20;
      const a = c < 16 ? 1 : clamp01((18 - c) / 2);
      let left = clamp01(c / 12) * PLAN_TOTAL;
      g.save();
      g.lineCap = "round";
      g.strokeStyle = `rgba(232,238,240,${0.85 * a})`;
      g.lineWidth = 0.9;
      for (let i = 0; i < PLAN.length && left > 0; i++) {
        partial(g, PLAN[i]!, left);
        left -= PLAN_LEN[i]!;
      }
      g.restore();
      const lift =
        clamp01(0.15 + gust(t, 3.3)) * (0.75 + 0.25 * Math.sin(t * 3.1));
      g.beginPath();
      g.moveTo(SHEET[2], SHEET[3] - FLAP);
      g.lineTo(SHEET[2] - FLAP, SHEET[3]);
      g.lineTo(SHEET[2] - lift * 9, SHEET[3] - lift * 13);
      g.closePath();
      g.fillStyle = lift > 0.5 ? "#6d8296" : "#52687e";
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 1;
      g.lineJoin = "round";
      g.stroke();
    }
    // the builder on the scaffold, driving pegs into the post: three blows, a breath, three blows (home at night)
    if (!s.night) {
      const p = t % 5.2;
      const blow = p < 2.7 ? Math.abs(Math.sin((p * Math.PI) / 0.9)) ** 3 : 0;
      const x = -146;
      const y = DECK - 1;
      const nod = blow * 1.2;
      g.save();
      g.lineJoin = "round";
      g.lineCap = "round";
      g.strokeStyle = INK;
      g.lineWidth = 1;
      g.fillStyle = "#4a4438";
      g.fillRect(x - 6, y - 22, 5, 22);
      g.strokeRect(x - 6, y - 22, 5, 22);
      g.fillRect(x + 1, y - 22, 5, 22);
      g.strokeRect(x + 1, y - 22, 5, 22);
      g.fillStyle = "#3a332c";
      g.fillRect(x - 6, y - 3, 7, 3);
      g.fillRect(x + 1, y - 3, 7, 3);
      g.fillStyle = accent(s.hue, 0.1);
      g.beginPath();
      g.roundRect(x - 8, y - 44 + nod * 0.5, 16, 24, 3);
      g.fill();
      g.stroke();
      g.fillStyle = "#d2a988";
      disc(g, x + 1, y - 50 + nod, 5.6);
      g.fill();
      g.stroke();
      // hard hat
      g.fillStyle = "#c9a655";
      g.beginPath();
      g.arc(x + 1, y - 51.5 + nod, 6.2, Math.PI, 0);
      g.lineTo(x + 10, y - 51 + nod);
      g.lineTo(x - 5.2, y - 51 + nod);
      g.closePath();
      g.fill();
      g.stroke();
      // the arm and the mallet: raised, then down on the peg
      g.translate(x + 5, y - 40 + nod * 0.5);
      g.rotate(-1.9 + blow * 1.55);
      seg(g, 0, 0, 13, 0);
      g.strokeStyle = "rgba(48,38,28,.88)";
      g.lineWidth = 5.4;
      g.stroke();
      g.strokeStyle = accent(s.hue, 0.1);
      g.lineWidth = 3.4;
      g.stroke();
      seg(g, 13, 0, 13, -9);
      g.strokeStyle = "#6e573f";
      g.lineWidth = 1.8;
      g.stroke();
      g.fillStyle = "#8a7253";
      g.strokeStyle = INK;
      g.lineWidth = 0.9;
      g.fillRect(8.5, -13.5, 9, 5);
      g.strokeRect(8.5, -13.5, 9, 5);
      g.restore();
    }
    // the plumb line off the scaffold
    const sw = Math.sin(t * 1.6) * (0.04 + 0.06 * Math.max(0, gust(t, 1)));
    const px = POLE_X[0] - 7;
    const py = -130;
    const bx = px + Math.sin(sw) * 108;
    const by = py + Math.cos(sw) * 108;
    g.strokeStyle = "rgba(48,38,28,.8)";
    g.lineWidth = 0.9;
    seg(g, px, py, bx, by);
    g.stroke();
    g.fillStyle = BRASS;
    g.beginPath();
    g.moveTo(bx - 4, by);
    g.lineTo(bx + 4, by);
    g.lineTo(bx, by + 11);
    g.closePath();
    g.fill();
    g.lineWidth = 1.1;
    g.stroke();
    g.fillStyle = BRASS_D;
    g.fillRect(bx - 2, by - 3, 4, 3);
    // a lamp left burning in the finished room
    glowPane(g, s, -95, -68, 18, 30, 0.4);
  },
};
