// The scenery sprites: faceted boulders, props (barrels, crates, lamps, the
// fire ring…), clouds, the dock, the boat and the ferry — each drawn once and
// placed many times — and the trees and bushes (`foliage.ts`) and the well
// (`well.ts`). The boulders, sacks, haystack, clouds and dock draw from one
// seeded stream in a fixed order; the rest own theirs.

import {
  INK,
  blob,
  grain,
  inkLine,
  lazySprite,
  pen,
  penLine,
  ring,
  seeded,
  sprite,
  type Ctx,
  type Rnd,
  type Sprite,
} from "./kit";
import { ROCK_COUNT, rockSize } from "./kit";
import { makeBushes, makeTrees } from "./foliage";
import { wellSprite } from "./well";

const poly = (g: Ctx, pts: readonly (readonly [number, number])[]) => {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
};

function boulderSprite(rnd: Rnd, s: number, mossy: boolean): Sprite {
  return sprite(s * 2.6, s * 2.2, s * 1.3, s * 1.45, (g) => {
    const n = 7 + ((rnd() * 3) | 0);
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / (n - 1)) * Math.PI;
      const r = s * (0.78 + rnd() * 0.32);
      pts.push([Math.cos(a) * r, Math.sin(a) * r * (0.9 + rnd() * 0.3)]);
    }
    const base: [number, number][] = [
      [s * 1.02, s * 0.12],
      [s * 0.5, s * 0.36],
      [-s * 0.4, s * 0.38],
      [-s * 1.0, s * 0.14],
    ];
    const outline = [...pts, ...base];
    g.fillStyle = "rgba(30,40,45,.28)";
    g.beginPath();
    g.ellipse(s * 0.25, s * 0.36, s * 1.15, s * 0.42, 0, 0, 7);
    g.fill();
    poly(g, outline);
    g.fillStyle = "#777c83";
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = "#4e535a";
    poly(g, [
      [s * 0.15, -s * 0.2],
      [s * 1.2, -s * 0.1],
      [s * 1.2, s * 0.6],
      [-s * 0.2, s * 0.6],
      [-s * 0.1, s * 0.1],
    ]);
    g.fill();
    g.fillStyle = "#a9adb1";
    poly(g, [
      [-s * 1.2, -s * 0.1],
      [-s * 0.6, -s * 1.1],
      [s * 0.35, -s * 1.1],
      [s * 0.1, -s * 0.3],
      [-s * 0.5, -s * 0.05],
    ]);
    g.fill();
    g.fillStyle = "#c3c6c8";
    poly(g, [
      [-s * 0.7, -s * 0.55],
      [-s * 0.35, -s * 0.95],
      [s * 0.1, -s * 0.85],
      [-s * 0.15, -s * 0.45],
    ]);
    g.fill();
    for (let i = 0; i < s * 3; i++) {
      g.fillStyle =
        rnd() < 0.5 ? "rgba(40,45,52,.22)" : "rgba(230,232,232,.25)";
      g.fillRect((rnd() - 0.5) * s * 2, -s * rnd() * 1.1 + s * 0.2, 1.2, 1.2);
    }
    if (mossy)
      for (let i = 0; i < s * 1.5; i++) {
        g.fillStyle = ["#6f7a42", "#8b9455", "#5c6838"][(rnd() * 3) | 0]!;
        g.beginPath();
        g.arc(
          (rnd() - 0.6) * s * 1.4,
          -s * (0.55 + rnd() * 0.45),
          1 + rnd() * 2.2,
          0,
          7,
        );
        g.fill();
      }
    g.restore();
    inkLine(
      g,
      [
        [-s * 0.5, -s * 0.05],
        [s * 0.1, -s * 0.3],
        [s * 0.35, -s * 1.0],
      ],
      0.9,
      "rgba(40,40,45,.55)",
    );
    inkLine(
      g,
      [
        [s * 0.1, -s * 0.3],
        [s * 0.15, s * 0.3],
      ],
      0.9,
      "rgba(40,40,45,.5)",
    );
    if (s > 18)
      inkLine(
        g,
        [
          [-s * 0.8, -s * 0.2],
          [-s * 0.55, -s * 0.35],
          [-s * 0.6, -s * 0.6],
        ],
        0.8,
        "rgba(40,40,45,.45)",
      );
    poly(g, outline);
    g.strokeStyle = "rgba(36,34,36,.85)";
    g.lineWidth = 1.3;
    g.stroke();
  });
}

const shadowEllipse = (g: Ctx, x: number, rx: number, ry: number) => {
  g.fillStyle = "rgba(30,34,20,.3)";
  g.beginPath();
  g.ellipse(x, 0, rx, ry, 0, 0, 7);
  g.fill();
};

/** A lamp post: cast iron on a stepped foot, a four-paned lantern under a little roof (lit at night). */
function lampSprite(night: boolean): Sprite {
  return lazySprite(
    46,
    74,
    12,
    67,
    (g) => {
      const rnd = seeded(60013);
      g.fillStyle = "rgba(34,38,24,.27)";
      poly(g, [
        [-2, 0.5],
        [21, 5],
        [27, 4.4],
        [28, 7.4],
        [21, 8],
        [2, 3],
      ]);
      g.fill();
      g.beginPath();
      g.ellipse(3, 1.4, 7, 2.4, 0, 0, 7);
      g.fill();
      g.fillStyle = "#3c403b";
      poly(g, [
        [-2, -4],
        [-1.3, -45],
        [1.3, -45],
        [2, -4],
      ]);
      g.fill();
      g.fillRect(-4.6, -2.2, 9.2, 2.2);
      g.fillRect(-3.2, -5, 6.4, 3);
      g.fillRect(-2.6, -27, 5.2, 1.8);
      g.fillRect(-4.4, -46.4, 8.8, 1.6);
      g.fillStyle = "rgba(206,212,196,.4)";
      g.fillRect(-1.5, -44, 0.9, 39);
      g.fillRect(-4.4, -2.2, 3, 0.8);
      g.fillStyle = "rgba(16,16,14,.35)";
      g.fillRect(0.5, -44, 1.3, 39);
      penLine(
        g,
        [
          [-2, -4],
          [-1.3, -45],
        ],
        rnd,
        0.9,
        0.8,
        0.3,
      );
      penLine(
        g,
        [
          [2, -4],
          [1.3, -45],
        ],
        rnd,
        1,
        0.85,
        0.3,
      );
      g.strokeStyle = pen(0.85);
      g.lineWidth = 0.9;
      g.strokeRect(-4.6, -2.2, 9.2, 2.2);
      const glass: readonly (readonly [number, number])[] = [
        [-5.2, -46.4],
        [5.2, -46.4],
        [3.9, -57],
        [-3.9, -57],
      ];
      g.fillStyle = night ? "#ffd987" : "#d6d0bb";
      poly(g, glass);
      g.fill();
      if (!night) {
        g.fillStyle = "rgba(120,140,150,.35)";
        poly(g, [
          [0.4, -46.4],
          [5.2, -46.4],
          [3.9, -57],
          [0.3, -57],
        ]);
        g.fill();
        g.fillStyle = "rgba(255,252,240,.5)";
        g.fillRect(-3.4, -55.5, 1.2, 6);
      }
      g.strokeStyle = "#23221f";
      g.lineWidth = 1.1;
      g.lineJoin = "round";
      poly(g, glass);
      g.stroke();
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(0, -46.4);
      g.lineTo(0, -57);
      g.stroke();
      g.fillStyle = "#2b2a27";
      poly(g, [
        [-6.4, -57],
        [-1, -61.6],
        [1, -61.6],
        [6.4, -57],
      ]);
      g.fill();
      g.fillRect(-0.7, -64, 1.4, 2.6);
      g.fillStyle = "rgba(210,214,200,.3)";
      poly(g, [
        [-5.6, -57.2],
        [-1, -61.2],
        [-0.2, -61.2],
        [-3.4, -57.2],
      ]);
      g.fill();
    },
    // (where a lamp may stand is still decided by the plain post's box it replaced)
    { fit: { w: 24, h: 70, ax: 12, ay: 66 } },
  );
}

/**
 * The fire ring: trodden, scorched earth, an ash bed, a ring of sooty
 * fieldstones and charred logs. `front`: only what lies nearest the viewer —
 * the near stones and two low logs — which the engine lays back over the
 * flame's foot each frame, so the fire rises from among them. Every part
 * draws from its own stream, so the two paintings agree to the pixel.
 */
function campSprite(front: boolean): Sprite {
  return lazySprite(104, 66, 50, 36, (g) => {
    const blot = (rnd: Rnd, n: number, rx: number, ry: number, dy: number) =>
      ring(
        Array.from({ length: n }, (_, i) => {
          const a = (i / n) * 6.283;
          const k = 0.86 + rnd() * 0.28;
          return [Math.cos(a) * rx * k, dy + Math.sin(a) * ry * k] as const;
        }),
      );
    if (!front) {
      const rnd = seeded(51407);
      g.fillStyle = "rgba(90,74,50,.2)";
      g.fill(blot(rnd, 12, 42, 24, 2));
      g.fillStyle = "rgba(50,42,32,.3)";
      g.fill(blot(rnd, 11, 30, 17, 1));
      g.fillStyle = "#4e4842";
      g.beginPath();
      g.ellipse(0, 0, 16, 9.5, 0, 0, 7);
      g.fill();
      for (let i = 0; i < 46; i++) {
        const a = rnd() * 7;
        const d = Math.sqrt(rnd());
        g.fillStyle = [
          "rgba(196,190,178,.6)",
          "rgba(30,26,24,.6)",
          "rgba(120,112,104,.6)",
        ][i % 3]!;
        g.fillRect(Math.cos(a) * d * 15, Math.sin(a) * d * 8.5, 1.1, 1.1);
      }
    }
    const stoneAt = (i: number) => {
      const rnd = seeded(51500 + i);
      const a = (i / 11) * 6.283 + 0.25;
      const x = Math.cos(a) * 21;
      const y = Math.sin(a) * 12.5;
      const rx = 5.2 + rnd() * 2.2;
      const ry = 3.6 + rnd() * 1.4;
      const v = 0.82 + rnd() * 0.3;
      const rot = (rnd() - 0.5) * 0.7;
      const P = ring(
        Array.from({ length: 7 }, (_, q) => {
          const b = (q / 7) * 6.283 + rot;
          const k = 0.86 + rnd() * 0.3;
          return [
            x + Math.cos(b) * rx * k,
            y - 1.5 + Math.sin(b) * ry * k,
          ] as const;
        }),
      );
      g.fillStyle = "rgba(30,28,22,.3)";
      g.beginPath();
      g.ellipse(x + 2, y + 1.2, rx, ry * 0.7, 0, 0, 7);
      g.fill();
      g.save();
      g.fillStyle = `rgb(${(150 * v) | 0},${(146 * v) | 0},${(136 * v) | 0})`;
      g.fill(P);
      g.clip(P);
      g.fillStyle = "rgba(244,240,226,.3)";
      g.beginPath();
      g.ellipse(
        x - rx * 0.35,
        y - 1.5 - ry * 0.45,
        rx * 0.6,
        ry * 0.5,
        0,
        0,
        7,
      );
      g.fill();
      g.fillStyle = "rgba(36,32,28,.34)";
      g.beginPath();
      g.ellipse(x + rx * 0.45, y - 1.5 + ry * 0.6, rx * 0.8, ry * 0.6, 0, 0, 7);
      g.fill();
      // soot on the fire's side
      g.fillStyle = "rgba(22,20,18,.4)";
      g.beginPath();
      g.ellipse(
        x - Math.cos(a) * rx * 0.9,
        y - 1.5 - Math.sin(a) * ry * 0.9,
        rx * 0.6,
        ry * 0.6,
        0,
        0,
        7,
      );
      g.fill();
      g.restore();
      g.strokeStyle = pen(0.8);
      g.lineWidth = 0.95;
      g.stroke(P);
    };
    const near = (i: number) => Math.sin((i / 11) * 6.283 + 0.25) >= 0;
    if (!front) for (let i = 0; i < 11; i++) if (!near(i)) stoneAt(i);
    // charred logs: two leaning together at the back, two lying low across the flame's foot
    (
      [
        [-13, 5, 5, -6],
        [13, 4, -4, -7],
        [-12, 5.5, 5, 2.5],
        [12, 6.5, -4, 4],
      ] as const
    ).forEach(([x0, y0, x1, y1], li) => {
      if (front && li < 2) return;
      const line = (
        ax: number,
        ay: number,
        bx: number,
        by: number,
        col: string,
        lw: number,
      ) => {
        g.strokeStyle = col;
        g.lineWidth = lw;
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      };
      g.lineCap = "round";
      line(x0, y0, x1, y1, pen(0.85), 5.8);
      line(x0, y0, x1, y1, "#4f3d2c", 4.6);
      const cf = li < 2 ? 0.5 : 0.74;
      const cx = x0 + (x1 - x0) * cf;
      const cy = y0 + (y1 - y0) * cf;
      line(cx, cy, x1, y1, "#2a221c", 4.6);
      // the embers' light along the charred end
      line(cx, cy - 1.6, x1, y1 - 1.6, "rgba(255,150,60,.55)", 0.9);
      line(
        x0,
        y0 - 1.4,
        (x0 + x1) / 2,
        (y0 + y1) / 2 - 1.4,
        "rgba(150,120,84,.5)",
        1,
      );
      g.fillStyle = "#b39a70";
      g.beginPath();
      g.ellipse(x0, y0, 2.1, 2.5, 0, 0, 7);
      g.fill();
      g.strokeStyle = pen(0.7);
      g.lineWidth = 0.7;
      g.stroke();
    });
    for (let i = 0; i < 11; i++) if (near(i)) stoneAt(i);
    grain(g, -50, -36, 104, 66, seeded(51499), 0.7);
  });
}

export interface Props {
  readonly barrel: Sprite;
  readonly crates: Sprite;
  readonly sacks: Sprite;
  readonly well: Sprite;
  readonly haystack: Sprite;
  readonly stump: Sprite;
  /** By time of day: lit at night. */
  readonly lamp: { readonly day: Sprite; readonly night: Sprite };
  readonly bushes: readonly Sprite[];
}

function makeProps(rnd: Rnd): Props {
  const barrel = sprite(34, 40, 17, 36, (g) => {
    shadowEllipse(g, 4, 12, 4);
    g.fillStyle = "#7d6546";
    g.beginPath();
    g.moveTo(-9, 0);
    g.quadraticCurveTo(-12, -13, -9, -26);
    g.lineTo(9, -26);
    g.quadraticCurveTo(12, -13, 9, 0);
    g.closePath();
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = "#5e4a34";
    g.fillRect(2, -25, 7, 24);
    for (let i = -6; i < 9; i += 4)
      inkLine(
        g,
        [
          [i, -25],
          [i + (i > 0 ? 1 : -1), -1],
        ],
        0.6,
        "rgba(50,40,28,.5)",
      );
    g.fillStyle = "#9b8562";
    g.beginPath();
    g.ellipse(0, -26, 9, 3.2, 0, 0, 7);
    g.fill();
    g.stroke();
    for (const y of [-20, -7])
      inkLine(
        g,
        [
          [-10.5, y],
          [10.5, y],
        ],
        1.8,
        "#4b4a48",
      );
  });
  const crates = sprite(56, 50, 26, 44, (g) => {
    shadowEllipse(g, 6, 22, 6);
    const box = (x: number, y: number, s: number) => {
      g.fillStyle = "#a08662";
      g.fillRect(x, y, s, s);
      g.fillStyle = "#86704f";
      g.fillRect(x + s * 0.65, y, s * 0.35, s);
      g.fillStyle = "#b9a07a";
      g.fillRect(x, y - s * 0.28, s, s * 0.28);
      g.strokeStyle = INK;
      g.lineWidth = 1;
      g.strokeRect(x, y - s * 0.28, s, s * 1.28);
      inkLine(
        g,
        [
          [x, y],
          [x + s, y],
        ],
        0.9,
      );
      inkLine(
        g,
        [
          [x + 2, y + 2],
          [x + s - 2, y + s - 2],
        ],
        0.8,
        "rgba(60,46,30,.6)",
      );
    };
    box(-20, -18, 18);
    box(0, -16, 16);
    box(-12, -40, 16);
  });
  const sacks = sprite(44, 34, 20, 30, (g) => {
    shadowEllipse(g, 5, 18, 5);
    for (const [x, y, r] of [
      [-8, -2, 9],
      [7, -1, 8],
      [0, -10, 8],
    ] as const) {
      g.fillStyle = "#b4a07a";
      blob(g, x, y - r * 0.6, r, rnd, 8, 0.2);
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 0.9;
      g.stroke();
      g.fillStyle = "rgba(90,70,45,.35)";
      g.beginPath();
      g.ellipse(x + r * 0.3, y - r * 0.4, r * 0.5, r * 0.6, 0, 0, 7);
      g.fill();
    }
  });
  // the old well drew 14 times from the stream; the sprites after it still expect it there
  for (let i = 0; i < 14; i++) rnd();
  const well = wellSprite();
  const haystack = sprite(70, 60, 34, 54, (g) => {
    shadowEllipse(g, 8, 30, 8);
    g.fillStyle = "#bba566";
    g.beginPath();
    g.moveTo(-28, 0);
    g.quadraticCurveTo(-30, -40, 0, -46);
    g.quadraticCurveTo(30, -40, 28, 0);
    g.closePath();
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = "rgba(120,100,50,.35)";
    g.beginPath();
    g.moveTo(4, -44);
    g.quadraticCurveTo(30, -38, 28, 0);
    g.lineTo(6, 0);
    g.closePath();
    g.fill();
    for (let i = 0; i < 40; i++) {
      const x = -24 + rnd() * 48;
      const y = -4 - rnd() * 36;
      if (Math.abs(x) > 28 - -y * 0.2) continue;
      inkLine(
        g,
        [
          [x, y],
          [x + 1 + rnd() * 2, y - 5 - rnd() * 4],
        ],
        0.7,
        rnd() < 0.5 ? "rgba(110,90,45,.6)" : "rgba(230,215,160,.6)",
      );
    }
  });
  const stump = sprite(34, 26, 16, 20, (g) => {
    shadowEllipse(g, 4, 13, 4);
    g.fillStyle = "#6a553c";
    poly(g, [
      [-11, 0],
      [-9, -11],
      [9, -11],
      [11, 0],
    ]);
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = "#c2a97c";
    g.beginPath();
    g.ellipse(0, -11, 9, 3.6, 0, 0, 7);
    g.fill();
    g.stroke();
    g.strokeStyle = "rgba(110,86,56,.7)";
    g.lineWidth = 0.6;
    g.beginPath();
    g.ellipse(0, -11, 4.5, 1.7, 0, 0, 7);
    g.stroke();
  });
  const lamp = { day: lampSprite(false), night: lampSprite(true) };
  const bushes = makeBushes();
  return { barrel, crates, sacks, well, haystack, stump, lamp, bushes };
}

function cloudSprite(rnd: Rnd): Sprite {
  return sprite(320, 150, 160, 120, (g) => {
    for (let i = 0; i < 26; i++) {
      const x = (rnd() - 0.5) * 230;
      const y = -40 + (rnd() - 0.5) * 50 - Math.abs(x) * 0.12;
      const r = 22 + rnd() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,255,255,.34)");
      gr.addColorStop(0.7, "rgba(250,252,255,.16)");
      gr.addColorStop(1, "rgba(250,252,255,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, 7);
      g.fill();
    }
    for (let i = 0; i < 10; i++) {
      const x = (rnd() - 0.5) * 200;
      const y = -22 + rnd() * 10;
      const r = 18 + rnd() * 20;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(150,170,200,.12)");
      gr.addColorStop(1, "rgba(150,170,200,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, 7);
      g.fill();
    }
  });
}

export const DOCK_LEN = 190;

export interface Rock {
  readonly s: number;
  readonly sp: Sprite;
}

/** Every sprite the scene stamps, and the stream they leave behind for the scene's own draws. */
export interface SpriteSet {
  readonly rocks: readonly Rock[];
  /** 0..7 broadleaves (sapling to old oak), 8..10 conifers. */
  readonly trees: readonly Sprite[];
  readonly autumn: readonly Sprite[];
  readonly props: Props;
  readonly clouds: readonly Sprite[];
  readonly dock: Sprite;
  readonly boat: Sprite;
  readonly ferry: Sprite;
  readonly campStones: Sprite;
  /** The fire ring's near stones and logs alone, laid over the flame's foot each frame. */
  readonly campFront: Sprite;
  /** The scene's stream, past the sprites (ripples, clouds, gulls, villagers draw from it). */
  readonly rnd: Rnd;
}

export function makeSprites(): SpriteSet {
  const rnd = seeded(20251111);
  const rocks = Array.from({ length: ROCK_COUNT }, (_, i) => {
    const s = rockSize(i);
    return { s, sp: boulderSprite(rnd, s, i % 3 === 0) };
  });
  // (the trees, bushes, lamps and fire ring each paint from a stream of their own, when first shown)
  const { trees, autumn } = makeTrees();
  const props = makeProps(rnd);
  const clouds = [cloudSprite(rnd), cloudSprite(rnd), cloudSprite(rnd)];
  const dock = sprite(DOCK_LEN + 20, 70, 10, 35, (dg) => {
    for (let i = 0; i < DOCK_LEN; i += 11) {
      const t = rnd();
      dg.fillStyle = `rgb(${118 + t * 30},${100 + t * 24},${76 + t * 18})`;
      dg.fillRect(i, -17 + rnd() * 2, 10, 34);
      dg.strokeStyle = INK;
      dg.lineWidth = 0.8;
      dg.strokeRect(i, -17, 10, 34);
      inkLine(
        dg,
        [
          [i + 4, -14],
          [i + 4, 12],
        ],
        0.5,
        "rgba(60,48,34,.45)",
      );
    }
    for (let i = 16; i <= DOCK_LEN; i += 44) {
      dg.fillStyle = "#4e3e2c";
      dg.fillRect(i, 15, 6, 14);
      dg.fillRect(i, -22, 6, 8);
      dg.strokeStyle = INK;
      dg.strokeRect(i, 15, 6, 14);
      dg.strokeRect(i, -22, 6, 8);
    }
    dg.strokeStyle = "rgba(86,70,50,.9)";
    dg.lineWidth = 1.4;
    dg.beginPath();
    dg.moveTo(0, -20);
    dg.lineTo(DOCK_LEN, -20);
    dg.stroke();
  });
  const boat = sprite(130, 120, 65, 100, (bg) => {
    bg.fillStyle = "rgba(20,40,55,.3)";
    bg.beginPath();
    bg.ellipse(6, 4, 52, 14, 0, 0, 7);
    bg.fill();
    bg.fillStyle = "#6b5438";
    bg.beginPath();
    bg.moveTo(-50, -10);
    bg.quadraticCurveTo(0, 16, 50, -10);
    bg.lineTo(42, -18);
    bg.lineTo(-42, -18);
    bg.closePath();
    bg.fill();
    bg.strokeStyle = INK;
    bg.lineWidth = 1.1;
    bg.stroke();
    for (let i = 0; i < 3; i++)
      inkLine(
        bg,
        [
          [-46 + i * 2, -12 + i * 3],
          [0, 6 + i * 3 - 4],
          [46 - i * 2, -12 + i * 3],
        ],
        0.6,
        "rgba(50,40,28,.5)",
      );
    bg.fillStyle = "#8f7a58";
    bg.fillRect(-40, -20, 80, 4);
    bg.strokeRect(-40, -20, 80, 4);
    bg.fillStyle = "#ddd3bb";
    bg.beginPath();
    bg.moveTo(2, -22);
    bg.lineTo(2, -88);
    bg.quadraticCurveTo(20, -60, 36, -26);
    bg.closePath();
    bg.fill();
    bg.stroke();
    bg.fillStyle = "rgba(120,100,70,.25)";
    bg.beginPath();
    bg.moveTo(2, -60);
    bg.quadraticCurveTo(18, -50, 30, -32);
    bg.lineTo(2, -30);
    bg.closePath();
    bg.fill();
    inkLine(
      bg,
      [
        [0, -20],
        [0, -94],
      ],
      2.4,
      "#4a3b2a",
    );
  });
  const ferry = sprite(90, 70, 45, 50, (fg) => {
    fg.fillStyle = "rgba(20,40,55,.3)";
    fg.beginPath();
    fg.ellipse(5, 4, 40, 10, 0, 0, 7);
    fg.fill();
    fg.fillStyle = "#5e4a34";
    fg.beginPath();
    fg.moveTo(-40, -6);
    fg.quadraticCurveTo(0, 12, 40, -6);
    fg.lineTo(34, -14);
    fg.lineTo(-34, -14);
    fg.closePath();
    fg.fill();
    fg.strokeStyle = INK;
    fg.lineWidth = 1;
    fg.stroke();
    fg.fillStyle = "#b9b2a3";
    fg.fillRect(-16, -32, 30, 18);
    fg.strokeRect(-16, -32, 30, 18);
    fg.fillStyle = "#7b6549";
    poly(fg, [
      [-20, -31],
      [0, -40],
      [18, -31],
    ]);
    fg.fill();
    fg.stroke();
    fg.fillStyle = "#3e3a36";
    fg.fillRect(4, -50, 5, 12);
  });
  const campStones = campSprite(false);
  const campFront = campSprite(true);
  return {
    rocks,
    trees,
    autumn,
    props,
    clouds,
    dock,
    boat,
    ferry,
    campStones,
    campFront,
    rnd,
  };
}
