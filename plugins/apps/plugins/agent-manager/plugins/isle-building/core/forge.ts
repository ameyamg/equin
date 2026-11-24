// The Agent Manager's building on Isle: the automaton works — a factory of
// riveted copper and brass plate on a stone footing, under a sawtooth roof of
// north lights with a round furnace port in each gable, two banded iron stacks
// and a brass signal mast behind. A wide brass-framed bay stands open on the
// lit forge; an overhead rail carries half-built automata (a torso, a head,
// legs, arms on hooks) out of it and across the yard to the charging rack.
// The agents are its life: a smith hammering at the anvil, an automaton put
// together piece by piece in the bay that wakes (the whistle blows) and walks
// out to the rack (the one before it leaves for work), a clerk ticking the
// task slate off row by row, a carrier walking crates of parts.

import {
  accent,
  barrel,
  castShadow,
  crate,
  dark,
  fittings,
  grain,
  hline,
  ink,
  mix,
  moss,
  oblique,
  planks,
  poly,
  shrub,
  stones,
  tufts,
  wash,
  type Box,
  type BuildingSpec,
  type Ctx2D,
  type Face,
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
  bar,
  rivet,
  metal,
  gust,
  puff,
} = fittings;

const COPPER = "#9a6c4a";
const GRAIN_BOX: Box = [-195, -430, 255, 60];
const sstep = (u: number): number => ease(clamp01(u));

/** The hall's front wall (left, right, top), how deep its right side is (SD) and what that comes to on screen (SY up). */
const L = -116;
const R = 124;
const WT = -150;
const SD = 26;
const SY = -oblique.rise(SD);
/** The bay: half width, the y its arch springs from, the arch's rise. */
const BAY = 58;
const BS = -70;
const RISE = 44;
/** The two stacks behind the roof (x, width, the y of the mouth); the taller one smokes. */
const STACKS = [
  [-86, 21, -352],
  [-54, 14, -306],
] as const;
const FLUE = [STACKS[0][0], STACKS[0][2]] as const;
/** The forge's fire, the anvil's foot, where the smith stands, where automata are put together. */
const FIRE = [-34, -42] as const;
const ANVIL = [-35, -3] as const;
const SMITH = [-9, -3] as const;
const BUILD = [34, -3] as const;
/** The task slate (x, y, width, height), the y of its rows, the x of its tick boxes; where the clerk stands. */
const BOARD = [-110, -106, 40, 56] as const;
const ROWS = [-93, -81, -69, -57] as const;
const TICKX = -102;
const CLERK = [-135, -30] as const;
/** The overhead rail (its y, its ends), the spacing of its hooks. */
const RAIL = [-104, -30, 210] as const;
const HOOKS = 4;
const SPAN = (RAIL[2] - RAIL[1] - 10) / HOOKS;
/** The charging rack's two stands (x) and their y; the carrier's run (from x, to x, at y). */
const RACK = [162, 196] as const;
const RACK_Y = 8;
const CARRY = [56, 136, 36] as const;
/** The sawtooth roof: how many teeth, how wide and how tall each is (its glazed face on the right). */
const TEETH = 3;
const TW = (R - L) / TEETH;
const TH = 50;
/** The round furnace ports in the roof's gables (x, y), and their radius. */
const PORT_R = 10.5;
const PORTS: readonly Pt[] = [0, 1, 2].map((i): Pt => [
  L + TW * (i + 1) - 19,
  WT - 19,
]);
/** The furnace vent on the wall (x, y, w, h), the pressure gauge (x, y, radius). */
const GRILLE = [69, -141, 46, 17] as const;
const GAUGE = [-90, -128, 11] as const;
/** The signal mast's lamp, and the steam whistle's mouth. */
const MAST: Pt = [R + 14, WT - TH - 64];
const WHISTLE = [-104, WT - 22] as const;
/** How big the automata are drawn: 37 px tall at 1. */
const SZ = 1.36;
/** One making of an automaton, s. */
const MAKE = 32;

interface BotPose {
  /** The phase of its step (radians), or null when it stands. */
  walk: number | null;
  /** Its forward lean (radians). */
  lean: number;
  /** How bright its eye is (0: out, 1: lit). */
  eye: number;
  /** How much of it there is: 1 legs, 2 and a body, 3 and a head. */
  parts: number;
  /** How far above its place the newest part still hangs, px. */
  drop: number;
}

const WHOLE: BotPose = { walk: null, lean: 0, eye: 1, parts: 3, drop: 0 };

/** An automaton's body, about its hip line. */
function torso(g: Ctx2D, eyeless: boolean): void {
  const bg = g.createLinearGradient(-6, 0, 6, 0);
  bg.addColorStop(0, BRASS_L);
  bg.addColorStop(0.45, BRASS);
  bg.addColorStop(1, BRASS_D);
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(-6, -23, 12, 14, 3);
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = "rgba(60,46,26,.6)";
  g.fillRect(-6, -15.5, 12, 1.2);
  g.fillStyle = "rgba(118,158,140,.5)";
  g.fillRect(-4.5, -13, 4, 2.4);
  rivet(g, -3.6, -20.6, 0.7);
  rivet(g, 2.6, -20.6, 0.7);
  if (!eyeless) {
    g.fillStyle = "#4a443c";
    g.fillRect(-1.3, -25.4, 2.6, 3);
  }
}

/** An automaton's head, its eye lit by `eye` (0..1). */
function head(g: Ctx2D, eye: number): void {
  const bg = g.createLinearGradient(-5, 0, 5, 0);
  bg.addColorStop(0, BRASS_L);
  bg.addColorStop(0.45, BRASS);
  bg.addColorStop(1, BRASS_D);
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(-5.2, -33.4, 10.4, 8.6, 3);
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = "#2a2622";
  disc(g, 2.2, -29.3, 2.1);
  g.fill();
  g.fillStyle = mix("#4a3c22", "#f2cd6c", eye);
  disc(g, 2.4, -29.3, 1.1);
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 0.8;
  seg(g, 0, -33.4, 0, -36.4);
  g.stroke();
  g.fillStyle = BRASS;
  disc(g, 0, -37, 1.3);
  g.fill();
  g.stroke();
}

/** An automaton's two legs, `st` its stride (-1..1), `bob` how far its hips dip. */
function legs(g: Ctx2D, st: number, bob: number): void {
  g.lineCap = "round";
  g.strokeStyle = "rgba(48,38,28,.9)";
  g.lineWidth = 4.2;
  seg(g, -2.2, -10 - bob, -2.2 - st * 3.2, 0);
  g.stroke();
  seg(g, 2.2, -10 - bob, 2.2 + st * 3.2, 0);
  g.stroke();
  g.strokeStyle = "#5a5148";
  g.lineWidth = 2.4;
  seg(g, -2.2, -10 - bob, -2.2 - st * 3.2, -0.6);
  g.stroke();
  seg(g, 2.2, -10 - bob, 2.2 + st * 3.2, -0.6);
  g.stroke();
}

/**
 * A brass automaton standing at (x, y) and facing `dir` (1: right), `sz` its
 * scale. Its arms are drawn apart (`arm`). It takes no randomness: `animate`
 * draws it too.
 */
function bot(
  g: Ctx2D,
  x: number,
  y: number,
  dir: number,
  sz: number,
  p: BotPose,
): void {
  const st = p.walk === null ? 0 : Math.sin(p.walk);
  const bob = p.walk === null ? 0 : Math.abs(Math.cos(p.walk)) * 0.9;
  g.save();
  g.translate(x, y);
  g.scale(dir * sz, sz);
  g.lineJoin = "round";
  if (p.parts === 1) g.translate(0, -p.drop / sz);
  legs(g, st, bob);
  if (p.parts >= 2) {
    g.translate(0, -10 - bob);
    g.rotate(p.lean);
    g.translate(0, 10);
    if (p.parts === 2) g.translate(0, -p.drop / sz);
    torso(g, p.parts === 2);
    if (p.parts >= 3) {
      if (p.drop > 0) g.translate(0, -p.drop / sz);
      head(g, p.eye);
    }
  }
  g.restore();
}

/** The soft shadow under a standing automaton. */
function botShadow(
  g: Ctx2D,
  x: number,
  y: number,
  sz: number,
  a: number,
): void {
  g.fillStyle = `rgba(30,34,20,${0.3 * a})`;
  g.beginPath();
  g.ellipse(x + 2 * sz, y + 0.5, 8 * sz, 2.4 * sz, 0, 0, TAU);
  g.fill();
}

/** An automaton's arm, from its shoulder to its hand. */
function arm(g: Ctx2D, x0: number, y0: number, x1: number, y1: number): void {
  g.save();
  g.lineCap = "round";
  seg(g, x0, y0, x1, y1);
  g.strokeStyle = "rgba(48,38,28,.9)";
  g.lineWidth = 4.8;
  g.stroke();
  g.strokeStyle = "#8a6e40";
  g.lineWidth = 2.8;
  g.stroke();
  g.fillStyle = BRASS_D;
  disc(g, x0, y0, 2.1);
  g.fill();
  g.restore();
}

/** A crate in an automaton's hands, centred on (x, y). */
function load(g: Ctx2D, x: number, y: number): void {
  g.fillStyle = "#a08460";
  g.fillRect(x - 7.5, y - 7.5, 15, 15);
  g.strokeStyle = INK;
  g.lineWidth = 1;
  g.strokeRect(x - 7.5, y - 7.5, 15, 15);
  g.lineWidth = 0.7;
  seg(g, x - 7.5, y - 2.5, x + 7.5, y - 2.5);
  g.stroke();
  seg(g, x - 7.5, y + 2.5, x + 7.5, y + 2.5);
  g.stroke();
}

/** What hangs from one of the rail's hooks, its top at (x, y): 0 a body, 1 a head, 2 legs, 3 a pair of arms. */
function hung(
  g: Ctx2D,
  kind: number,
  x: number,
  y: number,
  sway: number,
): void {
  g.save();
  g.translate(x, y);
  g.rotate(sway);
  g.strokeStyle = INK;
  g.lineWidth = 1.1;
  seg(g, 0, -9, 0, 0);
  g.stroke();
  g.lineJoin = "round";
  g.scale(SZ, SZ);
  if (kind === 0) {
    g.translate(0, 23);
    torso(g, true);
  } else if (kind === 1) {
    g.translate(0, 37.6);
    head(g, 0);
  } else if (kind === 2) {
    g.translate(0, 11);
    g.strokeStyle = INK;
    g.lineWidth = 1.2;
    seg(g, -3.4, -11, 3.4, -11);
    g.stroke();
    legs(g, 0.25, 0);
  } else {
    g.lineCap = "round";
    for (const dx of [-2.6, 2.6]) {
      seg(g, dx, 0.6, dx * 1.5, 12);
      g.strokeStyle = "rgba(48,38,28,.9)";
      g.lineWidth = 3.4;
      g.stroke();
      g.strokeStyle = "#8a6e40";
      g.lineWidth = 2;
      g.stroke();
    }
  }
  g.restore();
}

/** The bay's opening, grown by `grow` px: the path of its arch and jambs. */
function bayPath(g: Ctx2D, grow: number): void {
  g.beginPath();
  g.moveTo(-BAY - grow, 0);
  g.lineTo(-BAY - grow, BS);
  g.ellipse(0, BS, BAY + grow, RISE + grow, 0, Math.PI, TAU);
  g.lineTo(BAY + grow, 0);
}

/** A charging stand at (x, y): a stone foot, the post that carries the rail, a copper coil and a lamp on it. */
function stand(
  g: Ctx2D,
  x: number,
  y: number,
  r: () => number,
  lit: boolean,
): void {
  g.fillStyle = "rgba(34,40,22,.28)";
  g.beginPath();
  g.ellipse(x + 5, y + 1, 16, 4, 0, 0, TAU);
  g.fill();
  stones(g, x - 13, y - 5, x + 13, y, r, {
    rowH: 5,
    blockW: 9,
    base: "#a59d8b",
  });
  seg(g, x - 12, y - 5, x - 12, RAIL[0] + 2);
  bar(g, 3.6, "#6e573f", "rgba(255,240,210,.3)");
  for (let yy = y - 40; yy > y - 58; yy -= 3.6) {
    g.beginPath();
    g.ellipse(x - 12, yy, 5.2, 1.8, 0, 0, TAU);
    g.strokeStyle = COPPER;
    g.lineWidth = 1.7;
    g.stroke();
    ink(g, 0.5, 0.5);
    g.stroke();
  }
  disc(g, x - 12, y - 66, 3);
  g.fillStyle = lit ? "#ffd27a" : "#c9c0a4";
  g.fill();
  ink(g, 0.8);
  g.stroke();
}

/** The north light of tooth `i`: the glazed face on its right, receding. */
function glazing(i: number): Face {
  return oblique.sideFace(L + TW * (i + 1), WT, WT - TH, SD);
}

export const forge: BuildingSpec = {
  door: { kind: "opening", w: 2 * BAY, h: RISE - BS, head: RISE },
  footprint: {
    w: 276,
    depth: 96,
    ground: [-193, -112, 250, 57],
    upper: [-122, -438, 153, -112],
  },
  setting: ["lane"],
  signX: -204,
  chimney: { x: FLUE[0], y: FLUE[1], puffs: 7 },
  lights: [
    [0, -34, 44],
    [RACK[0] - 12, RACK_Y - 66, 11],
    [RACK[1] - 12, RACK_Y - 66, 11],
    [GRILLE[0] + GRILLE[2] / 2, GRILLE[1] + GRILLE[3] / 2, 16],
    ...PORTS.map(([x, y]) => [x, y, 15] as const),
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const A = accent(s.hue);
    const CU = mix(COPPER, A, 0.28);
    castShadow(
      g,
      [
        [L + 6, 4],
        [R, 4],
        [R + 100, 40],
        [R + 112, -20],
        [R + SD, SY],
      ],
      0.3,
    );
    const HD = mix(BRASS, A, 0.22);
    const ROOF = "#5d5852";
    // the sawtooth roof: each tooth's sheeted slope, its north light on the right, its plated gable
    for (let i = 0; i < TEETH; i++) {
      const x0 = L + TW * i;
      const x1 = x0 + TW;
      const slope = oblique.extrude([x0, WT], [x1, WT - TH], SD);
      oblique.fill(g, slope, () =>
        metal(
          g,
          r,
          () => poly(g, slope),
          [x0, WT - TH + SY, x1 + SD, WT],
          ROOF,
          {
            verd: 0.14,
            bare: 0.22,
            bareCol: "120,74,44",
            shade: 0.3,
            lw: 1.3,
            streaks: 5,
            inside: () => {
              ink(g, 0.7, 0.45);
              for (let u = 0.14; u < 1; u += 0.145)
                hline(
                  g,
                  x0 + TW * u,
                  WT - TH * u,
                  x0 + TW * u + SD,
                  WT - TH * u + SY,
                  r,
                  0.4,
                );
            },
          },
        ),
      );
      const glass = glazing(i);
      const gl = g.createLinearGradient(x1, WT - TH, x1 + SD, WT);
      if (lit) {
        gl.addColorStop(0, "#ffe2a0");
        gl.addColorStop(1, "#dc9a48");
      } else {
        gl.addColorStop(0, "#74848a");
        gl.addColorStop(0.5, "#4c595f");
        gl.addColorStop(1, "#343c42");
      }
      oblique.fill(g, glass, (pts) => {
        poly(g, pts);
        g.fillStyle = gl;
        g.fill();
      });
      g.strokeStyle = "#3a3632";
      g.lineWidth = 1.5;
      for (const u of [0.34, 0.67]) {
        seg(g, x1 + SD * u, WT + SY * u, x1 + SD * u, WT + SY * u - TH);
        g.stroke();
      }
      seg(g, x1, WT - TH * 0.5, x1 + SD, WT - TH * 0.5 + SY);
      g.stroke();
      if (!lit) {
        g.strokeStyle = "rgba(226,236,236,.3)";
        g.lineWidth = 1.2;
        seg(g, x1 + 3, WT - TH + 8, x1 + 7, WT - TH * 0.5 - 6);
        g.stroke();
      }
      poly(g, glass);
      ink(g, 1.3);
      g.stroke();
      const gable: Pt[] = [
        [x0, WT],
        [x1, WT],
        [x1, WT - TH],
      ];
      // (a tooth's gable lies in the front plane: its pitch is no receding edge)
      oblique.diagonal(g, () =>
        metal(g, r, () => poly(g, gable), [x0, WT - TH, x1, WT], HD, {
          verd: 0.2,
          bare: 0.14,
          bareCol: "120,74,44",
          shade: 0.3,
          lw: 1.4,
          streaks: 4,
          inside: () => {
            for (let u = 0.1; u < 0.98; u += 0.1)
              rivet(g, x0 + TW * u, WT - TH * u + 3.4, 0.9);
            for (let y = WT - 8; y > WT - TH + 6; y -= 8)
              rivet(g, x1 - 4.4, y, 0.9);
            ink(g, 0.7, 0.4);
            hline(g, x1 - 40, WT, x1 - 40, WT - TH * 0.5, r, 0.4);
          },
        }),
      );
      seg(g, x0, WT, x1, WT - TH);
      bar(g, 2.6, BRASS_D, "rgba(226,204,150,.4)");
    }
    // the stacks rise THROUGH the first tooth's slope: riveted iron, brass-banded, a flared cap, and where each
    // comes out of the sheeting a brass flashing collar lying on the pitch
    const pitch = (x: number): number => WT - (TH * (x - L)) / TW;
    for (const [x, w, top] of STACKS) {
      const xl = x - w / 2 - 2;
      const xr = x + w / 2 + 2;
      const flue = () => {
        g.beginPath();
        g.moveTo(xl, pitch(xl) + 1);
        g.lineTo(x - w / 2 + 1, top);
        g.lineTo(x + w / 2 - 1, top);
        g.lineTo(xr, pitch(xr) + 1);
        g.closePath();
      };
      // (its foot is cut to the roof's pitch, which lies in the front plane: no receding edge)
      oblique.diagonal(g, () =>
        metal(g, r, flue, [xl, top, xr, pitch(xl) + 1], ROOF, {
          verd: 0.1,
          bare: 0.3,
          bareCol: "120,74,44",
          shade: 0.5,
          lw: 1.4,
          streaks: 4,
        }),
      );
      for (let y = top + 16; y < pitch(xr) - 14; y += 30) {
        g.fillStyle = BRASS_D;
        g.fillRect(x - w / 2 - 1.5, y, w + 3, 3.4);
        ink(g, 0.8, 0.7);
        g.strokeRect(x - w / 2 - 1.5, y, w + 3, 3.4);
        for (let k = x - w / 2 + 1; k < x + w / 2; k += 4.5)
          rivet(g, k, y + 0.9, 0.8);
      }
      g.fillStyle = "#3a3632";
      g.fillRect(x - w / 2 - 3, top - 5, w + 6, 7);
      ink(g, 1.1);
      g.strokeRect(x - w / 2 - 3, top - 5, w + 6, 7);
      g.fillStyle = "rgba(230,230,220,.2)";
      g.fillRect(x - w / 2 - 2, top - 4, w * 0.4, 1.4);
      // the collar: an upstand round the flue's foot, then the skirt dressed down onto the sheeting
      const collar: Pt[] = [
        [xl - 1.5, pitch(xl - 1.5) - 7],
        [xr + 1.5, pitch(xr + 1.5) - 7],
        [xr + 5, pitch(xr + 5) + 1.6],
        [xl - 5, pitch(xl - 5) + 1.6],
      ];
      oblique.diagonal(g, () => {
        poly(g, collar);
        g.fillStyle = BRASS_D;
        g.fill();
        ink(g, 1.1);
        g.stroke();
      });
      g.strokeStyle = "rgba(240,220,170,.5)";
      g.lineWidth = 1;
      seg(g, xl - 1, pitch(xl - 1) - 5.2, xr + 1, pitch(xr + 1) - 5.2);
      g.stroke();
      for (let k = xl + 1; k < xr; k += 5) rivet(g, k, pitch(k) - 2, 0.8);
    }
    // a round furnace port in each gable: a heavy brass rim, leaded glass (the lamp behind it breathes: see animate)
    for (const [x, y] of PORTS) {
      disc(g, x, y, PORT_R + 4);
      g.fillStyle = BRASS_D;
      g.fill();
      ink(g, 1.3);
      g.stroke();
      disc(g, x, y, PORT_R + 1.8);
      g.strokeStyle = "rgba(226,204,150,.5)";
      g.lineWidth = 1.1;
      g.stroke();
      for (let a = 0.3; a < TAU; a += TAU / 10)
        rivet(
          g,
          x + Math.cos(a) * (PORT_R + 2.9) - 0.4,
          y + Math.sin(a) * (PORT_R + 2.9) - 0.4,
          0.8,
        );
      const pg = g.createLinearGradient(
        x - PORT_R,
        y - PORT_R,
        x + PORT_R,
        y + PORT_R,
      );
      if (lit) {
        pg.addColorStop(0, "#ffe2a0");
        pg.addColorStop(1, "#e7a54e");
      } else {
        pg.addColorStop(0, "#6a5a48");
        pg.addColorStop(0.5, "#4a3c30");
        pg.addColorStop(1, "#2c2622");
      }
      disc(g, x, y, PORT_R);
      g.fillStyle = pg;
      g.fill();
      ink(g, 1);
      g.stroke();
      g.strokeStyle = "rgba(40,34,28,.7)";
      g.lineWidth = 1.2;
      seg(g, x, y - PORT_R, x, y + PORT_R);
      g.stroke();
      seg(g, x - PORT_R, y, x + PORT_R, y);
      g.stroke();
    }
    // the signal mast on the last ridge: brass, two collars, a ball lamp (it blinks: see animate)
    seg(g, MAST[0], WT - TH + SY * 0.5, MAST[0], MAST[1] + 5);
    bar(g, 2.6, BRASS, BRASS_L);
    [MAST[1] + 50, MAST[1] + 26].forEach((y, i) => {
      g.beginPath();
      g.ellipse(MAST[0], y, 6.5 - i * 2, 2.3, 0, 0, TAU);
      g.fillStyle = BRASS_D;
      g.fill();
      ink(g, 0.9);
      g.stroke();
    });
    disc(g, MAST[0], MAST[1], 6);
    const ag = g.createRadialGradient(
      MAST[0] - 2,
      MAST[1] - 2,
      1,
      MAST[0],
      MAST[1],
      6,
    );
    ag.addColorStop(0, BRASS_L);
    ag.addColorStop(1, mix(BRASS_D, A, 0.4));
    g.fillStyle = ag;
    g.fill();
    ink(g, 1.2);
    g.stroke();
    // the hall's side, receding: plate in shade, its seams along the view
    const side = oblique.sideFace(R, 0, WT, SD);
    oblique.fill(g, side, () =>
      metal(
        g,
        r,
        () => poly(g, side),
        [R, WT + SY, R + SD, 0],
        dark(CU, 0.34),
        {
          verd: 0.26,
          bare: 0.1,
          shade: 0.3,
          lw: 1.4,
          streaks: 4,
          inside: () => {
            ink(g, 0.8, 0.4);
            for (const y of [-52, -100]) {
              hline(g, R, y, R + SD, y + SY, r, 0.4);
              for (let x = 4; x < SD; x += 8)
                rivet(g, R + x, y + (SY * x) / SD - 3, 0.8);
            }
            stones(g, R, SY - 12, R + SD, 0, r, {
              rowH: 6,
              blockW: 12,
              base: "#8f8777",
              clip: () => poly(g, oblique.sideFace(R, 0, -12, SD)),
            });
          },
        },
      ),
    );
    // the front: riveted copper plate on a stone footing, a banded brass collar under the roof
    const edge = (x: number): boolean => Math.abs(x) > BAY + 12;
    metal(
      g,
      r,
      () => {
        g.beginPath();
        g.rect(L, WT, R - L, -WT);
      },
      [L, WT, R, 0],
      CU,
      {
        verd: 0.26,
        bare: 0.1,
        streaks: 22,
        inside: () => {
          ink(g, 0.8, 0.45);
          for (const y of [-52, -100]) {
            hline(g, L, y, -BAY - 10, y, r, 0.5);
            hline(g, BAY + 10, y, R, y, r, 0.5);
            for (let x = L + 5; x < R - 2; x += 8)
              if (edge(x)) rivet(g, x, y - 3.4, 0.9);
          }
          hline(g, 96, WT, 96, -12, r, 0.5);
          hline(g, -92, -52, -92, -12, r, 0.5);
          for (let y = WT + 14; y < -14; y += 8) {
            rivet(g, L + 3, y, 0.9);
            rivet(g, R - 5, y, 0.9);
            rivet(g, 92.4, y, 0.9);
          }
          const tg = g.createLinearGradient(0, WT, 0, WT + 30);
          tg.addColorStop(0, "rgba(24,18,12,.42)");
          tg.addColorStop(1, "rgba(24,18,12,0)");
          g.fillStyle = tg;
          g.fillRect(L, WT, R - L, 30);
          const bg = g.createLinearGradient(0, -40, 0, 0);
          bg.addColorStop(0, "rgba(24,18,12,0)");
          bg.addColorStop(1, "rgba(24,18,12,.26)");
          g.fillStyle = bg;
          g.fillRect(L, -40, R - L, 40);
        },
      },
    );
    stones(g, L - 2, -12, R + 1, 0, r, {
      rowH: 6,
      blockW: 16,
      base: "#a59d8b",
    });
    const cg = g.createLinearGradient(L, 0, R, 0);
    cg.addColorStop(0, BRASS_L);
    cg.addColorStop(0.4, BRASS);
    cg.addColorStop(1, dark(BRASS_D, 0.2));
    g.fillStyle = cg;
    g.fillRect(L - 3, WT - 3, R - L + 6, 9);
    ink(g, 1.3);
    g.strokeRect(L - 3, WT - 3, R - L + 6, 9);
    ink(g, 0.7, 0.5);
    hline(g, L - 3, WT + 2.6, R + 3, WT + 2.6, r, 0.3);
    for (let x = L + 1; x < R; x += 7) rivet(g, x, WT - 1, 0.9);
    // the furnace vent: a louvred brass grille, the fire behind it (it breathes: see animate)
    const [vx, vy, vw, vh] = GRILLE;
    g.beginPath();
    g.roundRect(vx - 3, vy - 3, vw + 6, vh + 6, 5);
    g.fillStyle = BRASS_D;
    g.fill();
    ink(g, 1.3);
    g.stroke();
    g.beginPath();
    g.roundRect(vx, vy, vw, vh, 3);
    const mg = g.createLinearGradient(0, vy, 0, vy + vh);
    mg.addColorStop(0, "#1c1815");
    mg.addColorStop(1, lit ? "#c66a2a" : "#7a4222");
    g.fillStyle = mg;
    g.fill();
    ink(g, 1);
    g.stroke();
    for (let x = vx + 5; x < vx + vw - 2; x += 6) {
      g.fillStyle = BRASS;
      g.fillRect(x - 1.3, vy + 0.6, 2.6, vh - 1.2);
      g.fillStyle = "rgba(24,18,12,.5)";
      g.fillRect(x + 0.7, vy + 0.6, 0.8, vh - 1.2);
    }
    for (const x of [vx - 1.4, vx + vw - 0.4])
      for (const y of [vy - 1.4, vy + vh - 0.4]) rivet(g, x, y, 0.9);
    // the steam whistle on the left eave
    seg(g, WHISTLE[0], WT - 3, WHISTLE[0], WHISTLE[1] + 5);
    bar(g, 3, BRASS, BRASS_L);
    g.fillStyle = BRASS_D;
    g.fillRect(WHISTLE[0] - 4.5, WHISTLE[1], 9, 6);
    ink(g, 0.9);
    g.strokeRect(WHISTLE[0] - 4.5, WHISTLE[1], 9, 6);
    // the pressure gauge (its needle moves: see animate)
    const [gx, gy, gr] = GAUGE;
    disc(g, gx, gy, gr + 3);
    g.fillStyle = BRASS_D;
    g.fill();
    ink(g, 1.3);
    g.stroke();
    disc(g, gx, gy, gr);
    g.fillStyle = lit ? "#f0dca0" : "#d8cfb4";
    g.fill();
    ink(g, 0.8, 0.7);
    g.stroke();
    for (let k = 0; k <= 8; k++) {
      const a = Math.PI * 0.85 + (k * Math.PI * 1.3) / 8;
      ink(g, k % 4 ? 0.7 : 1.1, 0.7);
      seg(
        g,
        gx + Math.cos(a) * (gr - 1.2),
        gy + Math.sin(a) * (gr - 1.2),
        gx + Math.cos(a) * (gr - 3.6),
        gy + Math.sin(a) * (gr - 3.6),
      );
      g.stroke();
    }
    g.strokeStyle = "rgba(140,74,58,.75)";
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(gx, gy, gr - 2.4, -Math.PI * 0.35, Math.PI * 0.12);
    g.stroke();
    // the open bay: the dark shop, the forge and its fire, the anvil, the parts bench, spare heads on a shelf
    g.save();
    bayPath(g, 0);
    g.closePath();
    g.clip();
    const gi = g.createLinearGradient(0, BS - RISE, 0, 0);
    gi.addColorStop(0, "#1b1714");
    gi.addColorStop(1, "#40362c");
    g.fillStyle = gi;
    g.fillRect(-BAY, BS - RISE, 2 * BAY, RISE - BS);
    stones(g, -55, -72, -13, -24, r, {
      rowH: 6,
      blockW: 9,
      base: "#5d554a",
      mortar: "#2d2822",
    });
    g.fillStyle = "#14110f";
    g.beginPath();
    g.roundRect(-49, -58, 30, 26, [10, 10, 0, 0]);
    g.fill();
    g.fillStyle = lit ? "#ffb35a" : "#e38a3c";
    g.beginPath();
    g.ellipse(FIRE[0], FIRE[1] + 4, 10.5, 4.6, 0, 0, TAU);
    g.fill();
    g.fillStyle = "#ffd98a";
    g.beginPath();
    g.ellipse(FIRE[0], FIRE[1] + 4.5, 5.2, 2.2, 0, 0, TAU);
    g.fill();
    poly(g, [
      [-60, -72],
      [-8, -72],
      [-22, -108],
      [-46, -108],
    ]);
    g.fillStyle = mix(CU, "#2a2420", 0.55);
    g.fill();
    ink(g, 1, 0.7);
    g.stroke();
    for (let x = -54; x < -12; x += 7) rivet(g, x, -75.4, 0.9);
    g.fillStyle = "#4b3d2e";
    g.fillRect(50, -32, 4, 32);
    planks(g, 16, -38, 58, -32, r, { base: "#7d6648", vertical: false, pw: 6 });
    g.fillStyle = "#8c8f92";
    g.fillRect(44, -41.4, 10, 3.4);
    g.fillStyle = "#b08d57";
    disc(g, 22, -41, 3.2);
    g.fill();
    const [ax, ay] = ANVIL;
    g.fillStyle = "rgba(20,16,12,.4)";
    g.beginPath();
    g.ellipse(ax + 3, ay + 1, 15, 3.6, 0, 0, TAU);
    g.fill();
    planks(g, ax - 7, ay - 12, ax + 7, ay, r, { base: "#6e573f", pw: 4.6 });
    g.fillStyle = "#4a4846";
    poly(g, [
      [ax - 14, ay - 22],
      [ax + 11, ay - 22],
      [ax + 7, ay - 17],
      [ax + 5, ay - 17],
      [ax + 6, ay - 12],
      [ax - 6, ay - 12],
      [ax - 5, ay - 17],
      [ax - 9, ay - 17],
    ]);
    g.fill();
    ink(g, 1);
    g.stroke();
    g.fillStyle = "rgba(230,230,224,.34)";
    g.fillRect(ax - 12, ay - 21.6, 21, 1.3);
    botShadow(g, SMITH[0], SMITH[1], SZ, 1);
    bot(g, SMITH[0], SMITH[1], -1, SZ, WHOLE);
    g.restore();
    // the bay's frame: a riveted brass arch and jambs
    g.save();
    bayPath(g, 5);
    g.lineJoin = "round";
    g.strokeStyle = BRASS_D;
    g.lineWidth = 10;
    g.stroke();
    bayPath(g, 3.4);
    g.strokeStyle = "rgba(226,204,150,.42)";
    g.lineWidth = 1.6;
    g.stroke();
    bayPath(g, 1.6);
    g.strokeStyle = "rgba(24,18,12,.34)";
    g.lineWidth = 3;
    g.stroke();
    g.restore();
    for (let a = Math.PI + 0.08; a < TAU; a += 0.135)
      rivet(
        g,
        Math.cos(a) * (BAY + 6.4) - 0.4,
        BS + Math.sin(a) * (RISE + 6.4) - 0.4,
        1,
      );
    for (let y = -6; y > BS; y -= 9)
      for (const k of [-1, 1]) rivet(g, k * (BAY + 6.4) - 0.4, y, 1);
    bayPath(g, 10);
    ink(g, 1.3);
    g.stroke();
    bayPath(g, 0);
    ink(g, 1.4);
    g.stroke();
    // the task slate on the left of the bay, the clerk on its box (its arm ticks: see animate)
    const [bx, by, bw, bh] = BOARD;
    g.fillStyle = "rgba(24,18,12,.3)";
    g.fillRect(bx - 1, by + 1, bw + 6, bh + 4);
    g.fillStyle = "#6e573f";
    g.fillRect(bx - 3, by - 3, bw + 6, bh + 6);
    ink(g, 1.2);
    g.strokeRect(bx - 3, by - 3, bw + 6, bh + 6);
    wash(
      g,
      () => {
        g.beginPath();
        g.rect(bx, by, bw, bh);
      },
      [bx, by, bx + bw, by + bh],
      "#39423f",
      r,
      { blob: 5, var: 14, shadeA: 0.2, lw: 0.9 },
    );
    for (const y of ROWS) {
      g.strokeStyle = "rgba(226,222,204,.62)";
      g.lineWidth = 1.4;
      hline(g, bx + 14, y, bx + 21 + r() * 9, y + (r() - 0.5), r, 0.8);
      g.lineWidth = 1;
      g.strokeRect(TICKX - 3.5, y - 3.5, 7, 7);
    }
    crate(g, CLERK[0] - 11, CLERK[1] + 35, 19, r);
    crate(g, CLERK[0] - 9, CLERK[1] + 17, 16, r);
    bot(g, CLERK[0], CLERK[1], 1, SZ, WHOLE);

    seg(g, R - 7, WT + 8, R - 7, -8);
    bar(g, 3.4, CU, "rgba(255,240,214,.3)");
    for (const y of [-122, -72]) {
      g.fillStyle = BRASS_D;
      g.fillRect(R - 10.4, y, 6.8, 3.4);
    }
    disc(g, R - 7, -30, 5.4);
    g.strokeStyle = "#7a2f22";
    g.lineWidth = 1.8;
    g.stroke();
    ink(g, 0.6, 0.6);
    g.stroke();
    // the overhead rail: an iron beam on wall brackets, out to a timber trestle in the yard
    const [ry, rx0, rx1] = RAIL;
    for (const x of [BAY + 16, R - 4]) {
      seg(g, x, ry - 2, x, ry - 13);
      bar(g, 2, IRON, null);
    }
    seg(g, rx0, ry, rx1 + 6, ry);
    bar(g, 4.4, "#4a4640", "rgba(220,220,210,.28)");
    for (let x = rx0 + 6; x < rx1; x += 16) rivet(g, x, ry - 0.6, 0.8);
    // the charging rack: two stands under the rail's end (who stands on them: see animate)
    for (const x of RACK) stand(g, x, RACK_Y, r, lit);
    // the yard: crates of parts, a quench barrel, scrap
    crate(g, CARRY[1] + 12, CARRY[2] + 6, 16, r);
    crate(g, CARRY[1] + 18, CARRY[2] - 11, 13, r);
    crate(g, CARRY[1] + 30, CARRY[2] + 8, 13, r);
    seg(g, CARRY[1] + 22, CARRY[2] - 24, CARRY[1] + 30, CARRY[2] - 36);
    bar(g, 2.6, "#8a6e40", null);
    barrel(g, -68, 14, 9, r);
    g.strokeStyle = "#5a4632";
    g.lineWidth = 2.6;
    g.beginPath();
    g.ellipse(-150, -10, 7, 18, 0.1, 0, TAU);
    g.stroke();
    ink(g, 0.8);
    g.stroke();
    moss(g, L, R, 0, r, 16);
    tufts(g, L, -BAY - 12, 2, r, 8);
    tufts(g, BAY + 12, R, 2, r, 8);
    tufts(g, 130, 210, 16, r, 8);
    for (const [x, y, z, k] of [
      [-158, 18, 16, 0],
      [-176, -8, 12, 2],
      [224, 4, 12, 1],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    const lit = s.night || s.dusk;
    // the forge breathing; sparks when the hammer falls
    const hp = (t * 0.62) % 1;
    g.save();
    g.globalCompositeOperation = "lighter";
    const f =
      0.6 +
      0.2 * Math.sin(t * 2.1) +
      0.12 * Math.sin(t * 7.3) +
      0.08 * Math.sin(t * 13.1);
    const fg = g.createRadialGradient(
      FIRE[0],
      FIRE[1],
      1,
      FIRE[0],
      FIRE[1],
      42,
    );
    fg.addColorStop(0, `rgba(255,150,60,${(lit ? 0.62 : 0.45) * f})`);
    fg.addColorStop(1, "rgba(255,120,40,0)");
    g.fillStyle = fg;
    g.fillRect(-BAY, -96, 76, 96);
    const sp = hp > 0.93 ? (hp - 0.93) / 0.07 : hp < 0.12 ? 1 + hp / 0.12 : -1;
    if (sp >= 0)
      for (let i = 0; i < 8; i++) {
        const a = -2.9 + i * 0.36;
        const d = 3 + sp * (8 + (i % 3) * 4);
        g.fillStyle = `rgba(255,${200 - i * 8},110,${0.9 * (1 - sp / 2)})`;
        g.fillRect(
          ANVIL[0] - 2 + Math.cos(a) * d,
          ANVIL[1] - 24 + Math.sin(a) * d * 0.8 + sp * sp * 2,
          1.7,
          1.7,
        );
      }
    g.restore();
    // the piece on the anvil, and the smith's hammer: up slowly, down hard
    g.fillStyle = "#c96a3c";
    g.fillRect(ANVIL[0] - 7, ANVIL[1] - 24.6, 12, 2.6);
    g.strokeStyle = INK;
    g.lineWidth = 0.7;
    g.strokeRect(ANVIL[0] - 7, ANVIL[1] - 24.6, 12, 2.6);
    const ha =
      hp < 0.78
        ? -0.25 - 1.5 * sstep(hp / 0.78)
        : -1.75 +
          1.5 * sstep((hp - 0.78) / 0.16) +
          (hp > 0.94 ? 0.06 * Math.sin((hp - 0.94) * 100) : 0);
    const hsx = SMITH[0] - 3.5 * SZ;
    const hsy = SMITH[1] - 20.5 * SZ;
    const ex = hsx - Math.cos(ha) * 11;
    const ey = hsy + Math.sin(ha) * 11 + 7;
    arm(g, hsx, hsy, ex, ey);
    g.save();
    g.translate(ex, ey);
    g.scale(-1, 1);
    g.rotate(ha + 0.5);
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.lineCap = "round";
    seg(g, 0, 0, 11, 0);
    g.stroke();
    g.strokeStyle = "#7d6648";
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = "#3e3c3a";
    g.fillRect(9, -4.4, 5.6, 8.8);
    g.strokeStyle = INK;
    g.lineWidth = 0.8;
    g.strokeRect(9, -4.4, 5.6, 8.8);
    g.restore();
    // an automaton is put together in the bay — legs, body, head, arms lowered on the chain — wakes, and walks out to the rack;
    // the one made before it waits there on its stand, then leaves for work
    const c = t % MAKE;
    const [mx, my] = BUILD;
    const sy0 = my - 20.5 * SZ;
    const placed = (at: number) => sstep((c - at) / 0.9);
    if (c < 13.5) {
      const parts = c < 1 ? 0 : c < 3.6 ? 1 : c < 6.2 ? 2 : 3;
      const at = parts === 1 ? 1 : parts === 2 ? 3.6 : 6.2;
      const drop = parts ? 30 * (1 - placed(at)) : 0;
      if (parts) {
        if (drop > 0.5) {
          g.strokeStyle = "rgba(20,16,12,.8)";
          g.lineWidth = 1;
          seg(
            g,
            mx,
            RAIL[0] + 4,
            mx,
            my - (parts === 1 ? 11 : parts === 2 ? 24 : 37) * SZ - drop,
          );
          g.stroke();
        }
        botShadow(g, mx, my, SZ, 1);
        bot(g, mx, my, -1, SZ, {
          walk: null,
          lean: 0,
          eye: sstep((c - 11.6) / 1.2),
          parts,
          drop,
        });
      }
      for (const [at2, dx] of [
        [8.6, -3.5],
        [10.2, 3],
      ] as const)
        if (c > at2) {
          const d = 26 * (1 - placed(at2));
          arm(g, mx + dx * SZ, sy0 - d, mx + dx * SZ - 1, sy0 + 15 - d);
        }
    }
    // the overhead rail: hooks carry half-built automata out of the bay, a stage at a time
    const [ry, rx0] = RAIL;
    const len = SPAN * HOOKS;
    const stage = Math.floor(t / 5);
    const mv = sstep((t % 5) / 2.2);
    for (let i = 0; i < HOOKS; i++) {
      const p = ((i + stage + mv) * SPAN) % len;
      const a = Math.min(1, p / 18) * Math.min(1, (len - p) / 18);
      if (a <= 0.02) continue;
      const x = rx0 + 5 + p;
      g.save();
      g.globalAlpha = a;
      g.fillStyle = IRON;
      g.fillRect(x - 4, ry - 3.4, 8, 8);
      g.strokeStyle = INK;
      g.lineWidth = 0.8;
      g.strokeRect(x - 4, ry - 3.4, 8, 8);
      hung(
        g,
        i,
        x,
        ry + 13,
        Math.sin(t * 2.4 + i) * 0.05 +
          (mv < 1 ? 0.14 * Math.sin(mv * Math.PI) : 0),
      );
      g.restore();
    }

    // the pressure gauge trembles
    const [gx, gy, gr] = GAUGE;
    const na =
      Math.PI * 1.5 +
      0.6 * Math.sin(t * 0.37) +
      0.1 * Math.sin(t * 5.3) +
      0.3 * gust(t, 2);
    g.strokeStyle = "#7a2f22";
    g.lineWidth = 1.5;
    g.lineCap = "round";
    seg(
      g,
      gx,
      gy,
      gx + Math.cos(na) * (gr - 3.4),
      gy + Math.sin(na) * (gr - 3.4),
    );
    g.stroke();
    g.fillStyle = IRON;
    disc(g, gx, gy, 1.8);
    g.fill();
    // the furnace: the vent's fire breathing behind its louvres, the round ports' lamps following it, the mast's lamp
    g.save();
    g.globalCompositeOperation = "lighter";
    const [vx, vy, vw, vh] = GRILLE;
    const vg = g.createRadialGradient(
      vx + vw / 2,
      vy + vh,
      2,
      vx + vw / 2,
      vy + vh * 0.6,
      34,
    );
    vg.addColorStop(0, `rgba(255,150,60,${(lit ? 0.6 : 0.34) * f})`);
    vg.addColorStop(1, "rgba(255,120,40,0)");
    g.fillStyle = vg;
    g.fillRect(vx - 6, vy - 8, vw + 12, vh + 14);
    PORTS.forEach(([x, y], i) => {
      const k =
        0.55 +
        0.3 * Math.sin(t * 0.9 + i * 2.1) +
        0.15 * Math.sin(t * 5.7 + i * 1.3);
      const pg = g.createRadialGradient(x, y + 2, 1, x, y, PORT_R);
      pg.addColorStop(0, `rgba(255,190,96,${(lit ? 0.5 : 0.75) * k})`);
      pg.addColorStop(1, "rgba(255,130,50,0)");
      g.fillStyle = pg;
      disc(g, x, y, PORT_R - 0.6);
      g.fill();
    });
    const bl = Math.max(0, Math.sin(t * 1.4)) ** 6;
    const lg = g.createRadialGradient(
      MAST[0],
      MAST[1],
      1,
      MAST[0],
      MAST[1],
      13,
    );
    lg.addColorStop(0, `rgba(255,214,130,${(lit ? 0.85 : 0.4) * bl})`);
    lg.addColorStop(1, "rgba(255,190,90,0)");
    g.fillStyle = lg;
    g.fillRect(MAST[0] - 14, MAST[1] - 14, 28, 28);
    g.restore();
    // the north lights: the shop's lamps behind the glass, at dusk and night
    if (lit)
      for (let i = 0; i < TEETH; i++) {
        const k = 0.5 + 0.3 * Math.sin(t * 1.3 + i * 1.9) + 0.2 * f;
        g.fillStyle = `rgba(255,226,150,${0.26 * k})`;
        poly(g, glazing(i));
        g.fill();
      }
    // the clerk ticks the slate off, row by row; then it is wiped and the day's tasks start again
    const cc = t % 17;
    const row = Math.min(3, Math.floor(cc / 3.4));
    const u = cc / 3.4 - row;
    const wipe = cc > 14.4 ? sstep((cc - 14.4) / 1.6) : 0;
    g.save();
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = `rgba(232,226,204,${0.95 * (1 - wipe)})`;
    g.lineWidth = 1.7;
    ROWS.forEach((y, i) => {
      const d =
        cc >= 13.6 ? 1 : i < row ? 1 : i === row ? sstep((u - 0.55) / 0.25) : 0;
      if (d <= 0) return;
      g.beginPath();
      g.moveTo(TICKX - 3, y - 0.4);
      g.lineTo(
        TICKX - 3 + 2.2 * Math.min(1, d * 2),
        y - 0.4 + 2.8 * Math.min(1, d * 2),
      );
      if (d > 0.5)
        g.lineTo(
          TICKX - 0.8 + 4.8 * (d - 0.5) * 2,
          y + 2.4 - 6.6 * (d - 0.5) * 2,
        );
      g.stroke();
    });
    g.restore();
    const reach =
      cc < 13.6 ? sstep((u - 0.3) / 0.25) * (1 - sstep((u - 0.82) / 0.16)) : 0;
    const sx = CLERK[0] + 3.5 * SZ;
    const sy = CLERK[1] - 20.5 * SZ;
    const ty =
      (ROWS[row] ?? ROWS[0]) +
      (u > 0.55 && u < 0.8 ? Math.sin((u - 0.55) * 25) * 1.8 : 0);
    const wiping = wipe > 0 && wipe < 1;
    const hx = wiping
      ? BOARD[0] + 17 + Math.sin(cc * 7) * 10
      : sx + 3 + (TICKX - 4 - sx - 3) * reach;
    const hy = wiping
      ? -78 + Math.sin(cc * 3.1) * 17
      : sy + 12 + (ty - sy - 12) * reach;
    arm(g, sx, sy, hx, hy);
    if (wiping) {
      g.fillStyle = "#cfc6ac";
      g.fillRect(hx - 3.5, hy - 3, 7, 6);
      g.strokeStyle = INK;
      g.lineWidth = 0.8;
      g.strokeRect(hx - 3.5, hy - 3, 7, 6);
    }
  },
  // the automata out in the yard — the one just made walking to the rack, those waiting there, the carrier — and
  // the whistle's steam: they come and go round the forge, they are not its shape
  ambient(g, s) {
    const t = s.t;
    const lit = s.night || s.dusk;
    const c = t % MAKE;
    const [mx, my] = BUILD;
    const walker = (
      x: number,
      y: number,
      dir: number,
      ph: number | null,
      eye: number,
      a: number,
    ) => {
      if (a <= 0.02) return;
      g.save();
      g.globalAlpha = a;
      botShadow(g, x, y, SZ, 1);
      bot(g, x, y, dir, SZ, {
        walk: ph,
        lean: ph === null ? 0 : 0.05,
        eye,
        parts: 3,
        drop: 0,
      });
      const shx = x + dir * 2.5 * SZ;
      const shy = y - 20.5 * SZ;
      arm(g, shx, shy, shx + (ph === null ? 0 : Math.sin(ph) * 5), shy + 15);
      g.restore();
    };
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.1);
    if (c >= 13.5 && c < 20) {
      const k1 = sstep((c - 13.5) / 2);
      const k2 = sstep((c - 15.5) / 4.5);
      const x = mx + (80 - mx) * k1 + (RACK[0] - 80) * k2;
      const y = my + (22 - my) * k1 + (RACK_Y - 22) * k2;
      walker(x, y, 1, (c - 13.5) * 5.2, 1, 1);
    } else if (c >= 20)
      walker(RACK[0], RACK_Y, -1, null, 0.25 + 0.35 * pulse, 1);
    if (c < 13.5)
      walker(RACK[0], RACK_Y, -1, null, c > 12 ? 1 : 0.25 + 0.35 * pulse, 1);
    else if (c < 18) {
      const k = sstep((c - 13.5) / 4.5);
      walker(
        RACK[0] + (236 - RACK[0]) * k,
        RACK_Y + 14 * Math.sin(k * Math.PI * 0.5),
        1,
        (c - 13.5) * 5.2,
        1,
        1 - sstep((k - 0.72) / 0.28),
      );
    }
    walker(RACK[1], RACK_Y, -1, null, 0.2 + 0.3 * (1 - pulse), 1);
    g.save();
    g.globalCompositeOperation = "lighter";
    for (const x of RACK) {
      const cg = g.createRadialGradient(
        x - 12,
        RACK_Y - 50,
        1,
        x - 12,
        RACK_Y - 50,
        15,
      );
      cg.addColorStop(
        0,
        `rgba(150,220,255,${(lit ? 0.3 : 0.14) * (0.4 + 0.6 * pulse)})`,
      );
      cg.addColorStop(1, "rgba(150,220,255,0)");
      g.fillStyle = cg;
      g.fillRect(x - 27, RACK_Y - 65, 30, 30);
    }
    g.restore();
    // the whistle on the eave lets off steam when an automaton wakes
    const wq = (c - 11.8) / 1.9;
    if (wq > 0 && wq < 1)
      for (const d of [0, 0.25, 0.5]) {
        const a = wq - d * 0.4;
        if (a > 0)
          puff(
            g,
            WHISTLE[0] + a * 14,
            WHISTLE[1] - 6 - a * 26,
            3 + a * 9,
            0.55 * (1 - a) * Math.min(1, a * 8),
          );
      }
    // the carrier walks crates of parts from the yard to the bay, and goes back for the next
    const [cx0, cx1, cy] = CARRY;
    const cq = (t * 0.075) % 1;
    const out = cq < 0.5;
    const k = out ? sstep((cq - 0.04) / 0.38) : 1 - sstep((cq - 0.54) / 0.38);
    const moving = k > 0.001 && k < 0.999;
    const bx = cx1 + (cx0 - cx1) * k;
    const dir = out ? -1 : 1;
    const ld = out
      ? moving
        ? 1
        : cq < 0.04
          ? cq / 0.04
          : Math.max(0, 1 - (cq - 0.42) / 0.06)
      : 0;
    botShadow(g, bx, cy, SZ, 1);
    bot(g, bx, cy, dir, SZ, {
      walk: moving ? k * 30 : null,
      lean: ld > 0.5 ? -0.08 : 0.04,
      eye: 1,
      parts: 3,
      drop: 0,
    });
    const shx = bx + dir * 3 * SZ;
    const shy = cy - 20.5 * SZ;
    if (ld > 0) {
      const lx = bx + dir * 13;
      const ly = cy - 28 + (1 - ld) * 18;
      load(g, lx, ly);
      arm(g, shx, shy, lx - dir * 3, ly + 3);
    } else
      arm(g, shx, shy, shx + Math.sin(k * 30) * 4 * (moving ? 1 : 0), cy - 14);
  },
};
