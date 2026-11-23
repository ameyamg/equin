// Mail's building on Isle: the pillar box — a post office built as a giant
// cast-iron pillar box in faded post-office red: a ribbed dome cap with a
// beaded rim, the letter slot under its hood (a real opening, lit from inside
// at night), the enamel collection plate, an envelope cast in relief, the door
// in its black base. It is the app at work: letters come in on the wind and
// slip into the slot, and each one that lands sends the signal arm up; a
// carrier pigeon flies in with a letter, rests on the finial and leaves again;
// a letter that missed shifts on the paving in the gusts.

import {
  accent,
  castShadow,
  dark,
  doorArch,
  fittings,
  grain,
  hline,
  ink,
  ivy,
  light,
  moss,
  oblique,
  planks,
  poly,
  sack,
  shrub,
  steps,
  tufts,
  wash,
  type Box,
  type BuildingSpec,
  type Ctx2D,
} from "@plugins/apps/plugins/isle/plugins/buildings/core";

const {
  TAU,
  INK,
  BRASS,
  BRASS_D,
  IRON,
  clamp01,
  ease,
  disc,
  seg,
  bar,
  rivet,
  porthole,
  metal,
  ring,
  paving,
  gust,
  glowPane,
} = fittings;

const GRAIN_BOX: Box = [-200, -350, 240, 60];
const sstep = (u: number): number => ease(clamp01(u));

/** The pillar: its radius, the y of its bottom and top rims, the vertical radius of its ellipses. */
const R = 72;
const YB = -13;
const YT = -250;
const EY = 13;
/** The letter slot: x, y, width, height. */
const SLOT = [-38, -220, 76, 12] as const;
/** The signal arm's pivot, and where the pigeon rests. */
const FLAG = [R + 5, -172] as const;
/** Faded post-office red: a pillar box is red whatever the app's colour (which only paints the signal arm's flag). */
const RED = "#a84c40";
const PERCH = [0, YT - 77] as const;
/** The letters on the wind: period (s), phase (s), the side they come from. */
const STREAMS = [
  [7.3, 0, 1],
  [11.9, 3.1, -1],
  [16.7, 9, 1],
] as const;
/** How long a letter is in the air, s. */
const FLY = 3.4;

function bodyPath(g: Ctx2D): void {
  g.beginPath();
  g.moveTo(-R, YB);
  g.lineTo(-R, YT);
  g.lineTo(R, YT);
  g.lineTo(R, YB);
  g.ellipse(0, YB, R, EY, 0, 0, Math.PI);
  g.closePath();
}

/** A band round the pillar: `h` tall above `y`, of radius `rr`. */
function bandPath(g: Ctx2D, y: number, rr: number, h: number): void {
  g.beginPath();
  g.moveTo(-rr, y);
  g.lineTo(-rr, y - h);
  g.lineTo(rr, y - h);
  g.lineTo(rr, y);
  g.ellipse(0, y, rr, (EY * rr) / R, 0, 0, Math.PI);
  g.closePath();
}

function capPath(g: Ctx2D): void {
  g.beginPath();
  g.moveTo(-R - 7, YT - 13);
  g.bezierCurveTo(-R + 3, YT - 49, -26, YT - 64, 0, YT - 65);
  g.bezierCurveTo(26, YT - 64, R - 3, YT - 49, R + 7, YT - 13);
  g.ellipse(0, YT - 13, R + 7, EY, 0, 0, Math.PI);
  g.closePath();
}

/** An envelope centred on (x, y): turned by `rot`, scaled by `sc`, flattened by `squash`, at opacity `a`. */
function envelope(
  g: Ctx2D,
  x: number,
  y: number,
  rot: number,
  sc: number,
  a: number,
  squash: number,
): void {
  if (a <= 0.02) return;
  g.save();
  g.globalAlpha = a;
  g.translate(x, y);
  g.rotate(rot);
  g.scale(sc, sc * squash);
  g.fillStyle = "#e9e0c6";
  g.fillRect(-6.5, -4.2, 13, 8.4);
  g.strokeStyle = INK;
  g.lineWidth = 0.9;
  g.lineJoin = "round";
  g.strokeRect(-6.5, -4.2, 13, 8.4);
  g.beginPath();
  g.moveTo(-6.5, -4.2);
  g.lineTo(0, 0.8);
  g.lineTo(6.5, -4.2);
  g.stroke();
  g.fillStyle = "#a8554a";
  g.fillRect(3, 1, 2.2, 2);
  g.restore();
}

/** A perched bird at (x, y) facing `dir`, `peck` (0..1) its head down. */
function bird(
  g: Ctx2D,
  x: number,
  y: number,
  dir: number,
  col: string,
  sz: number,
  peck: number,
): void {
  g.save();
  g.translate(x, y);
  g.scale(dir * sz, sz);
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

/** The same bird on the wing (`flap` -1..1), a letter in its beak when it carries one. */
function flier(
  g: Ctx2D,
  x: number,
  y: number,
  flap: number,
  col: string,
  a: number,
  carry: boolean,
): void {
  if (a <= 0.02) return;
  g.save();
  g.globalAlpha = a;
  g.translate(x, y);
  g.scale(1.3, 1.3);
  g.lineJoin = "round";
  g.strokeStyle = INK;
  g.lineWidth = 0.9;
  g.fillStyle = dark(col, 0.2);
  g.beginPath();
  g.moveTo(-2, -1);
  g.lineTo(-7, -1 - 9 * flap);
  g.lineTo(3, -1.5);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(-5, -1);
  g.lineTo(-11, 1.5);
  g.lineTo(-5, 1.6);
  g.closePath();
  g.fill();
  g.stroke();
  g.beginPath();
  g.ellipse(0, 0, 6, 3, -0.1, 0, TAU);
  g.fill();
  g.stroke();
  disc(g, 5.5, -2.2, 2.2);
  g.fill();
  g.stroke();
  g.fillStyle = "#c79a5a";
  g.fillRect(7.4, -2.4, 2, 1);
  g.fillStyle = light(col, 0.18);
  g.beginPath();
  g.moveTo(-3, 0);
  g.lineTo(-6, 9 * flap - 1);
  g.lineTo(3, 0.5);
  g.closePath();
  g.fill();
  g.stroke();
  if (carry) {
    g.fillStyle = "#e9e0c6";
    g.fillRect(7.6, -0.8, 5.4, 3.6);
    g.lineWidth = 0.7;
    g.strokeRect(7.6, -0.8, 5.4, 3.6);
  }
  g.restore();
}

export const pillarBox: BuildingSpec = {
  door: { kind: "leaf", w: 34, h: 60, arch: true },
  footprint: {
    w: 176,
    depth: 66,
    ground: [-163, -112, 233, 51],
    upper: [-128, -373, 132, -112],
  },
  setting: ["square"],
  signX: -176,
  lights: [
    [0, -214, 20],
    [-46, -120, 13],
    [46, -120, 13],
    [0, -30, 16],
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const BLK = "#3b3733";
    paving(g, r, 8, 3, 138, 36);
    castShadow(
      g,
      [
        [-58, 10],
        [72, 7],
        // (kept clear of the barrow's own shadow: two shadows add up into something the hover outlines)
        [172, 22],
        [212, 8],
        [180, -22],
        [76, -44],
      ],
      0.28,
    );
    // the pillar: a cast-iron drum in faded post-office red
    metal(g, r, () => bodyPath(g), [-R, YT, R, YB + EY], RED, {
      verd: 0.04,
      bare: 0.2,
      bareCol: "70,38,32",
      inside: () => {
        const hl = g.createLinearGradient(-R, 0, R, 0);
        hl.addColorStop(0.12, "rgba(255,246,226,0)");
        hl.addColorStop(0.26, "rgba(255,246,226,.2)");
        hl.addColorStop(0.42, "rgba(255,246,226,0)");
        g.fillStyle = hl;
        g.fillRect(-R, YT, 2 * R, YB - YT + EY);
        for (const y of [-190, -68]) {
          ink(g, 0.9, 0.5);
          ring(g, y, R, EY);
          g.stroke();
          g.strokeStyle = "rgba(255,240,214,.22)";
          g.lineWidth = 1;
          ring(g, y + 1.6, R, EY);
          g.stroke();
          for (let a = 0.12; a < Math.PI; a += 0.14)
            rivet(g, Math.cos(a) * R * 0.99, y + Math.sin(a) * EY - 3.6, 0.9);
        }
        ink(g, 0.7, 0.35);
        for (const x of [-52, 53]) hline(g, x, -186, x, -64, r, 0.5);
        const sg = g.createLinearGradient(0, YT, 0, YT + 30);
        sg.addColorStop(0, "rgba(24,16,12,.5)");
        sg.addColorStop(1, "rgba(24,16,12,0)");
        g.fillStyle = sg;
        g.fillRect(-R, YT, 2 * R, 30);
      },
    });
    // the black base
    metal(
      g,
      r,
      () => bandPath(g, YB, R + 5, 28),
      [-R - 5, YB - 28, R + 5, YB + EY + 1],
      BLK,
      { verd: 0.14, bare: 0.1, shade: 0.5, lw: 1.5 },
    );
    // the letter slot under its hood (the real opening), the enamel collection plate, an envelope cast in relief
    const [sx, sy, sw, sh] = SLOT;
    g.beginPath();
    g.roundRect(sx - 8, sy - 7, sw + 16, sh + 15, 5);
    g.fillStyle = dark(RED, 0.3);
    g.fill();
    ink(g, 1.2);
    g.stroke();
    g.beginPath();
    g.roundRect(sx, sy, sw, sh, 2.5);
    g.fillStyle = lit ? "#7a4a22" : "#191513";
    g.fill();
    ink(g, 1);
    g.stroke();
    g.fillStyle = BRASS_D;
    g.fillRect(sx, sy + sh - 2, sw, 2);
    poly(g, [
      [sx - 13, sy - 4],
      [sx + sw + 13, sy - 4],
      [sx + sw + 7, sy - 14],
      [sx - 7, sy - 14],
    ]);
    g.fillStyle = dark(RED, 0.12);
    g.fill();
    ink(g, 1.2);
    g.stroke();
    g.fillStyle = "rgba(255,240,214,.3)";
    g.fillRect(sx - 6, sy - 13.2, sw + 12, 1.4);
    g.fillStyle = "rgba(24,16,12,.4)";
    g.fillRect(sx - 8, sy - 4, sw + 16, 3.2);
    for (const x of [sx - 5, sx + sw + 3.4])
      for (const y of [sy - 4.4, sy + sh + 4]) rivet(g, x, y, 0.9);
    wash(
      g,
      () => {
        g.beginPath();
        g.rect(-22, -182, 44, 34);
      },
      [-22, -182, 22, -148],
      "#d6ccb0",
      r,
      { blob: 4, var: 16, shadeA: 0.16, lw: 1 },
    );
    ink(g, 0.7, 0.55);
    for (const [y, w] of [
      [-175, 26],
      [-169.5, 32],
      [-164, 22],
      [-158.5, 30],
      [-153, 18],
    ] as const)
      hline(g, -16, y, -16 + w, y, r, 0.3);
    for (const [x, y] of [
      [-20.4, -180.4],
      [18.6, -180.4],
      [-20.4, -150.6],
      [18.6, -150.6],
    ] as const)
      rivet(g, x, y, 0.8);
    g.fillStyle = "rgba(120,70,40,.28)";
    g.beginPath();
    g.ellipse(16, -151, 7, 4, 0, 0, TAU);
    g.fill();
    g.save();
    g.lineJoin = "round";
    for (const [dx, dy, c] of [
      [1, 1.2, "rgba(255,240,214,.3)"],
      [0, 0, "rgba(40,24,20,.6)"],
    ] as const) {
      g.strokeStyle = c;
      g.lineWidth = 1.6;
      g.beginPath();
      g.rect(-19 + dx, -134 + dy, 38, 26);
      g.moveTo(-19 + dx, -134 + dy);
      g.lineTo(dx, -118 + dy);
      g.lineTo(19 + dx, -134 + dy);
      g.stroke();
    }
    g.restore();
    for (const x of [-46, 46]) porthole(g, x, -120, 9, lit);
    doorArch(g, 0, 0, 34, 60, r, { col: dark(RED, 0.28), surround: false });
    g.beginPath();
    g.moveTo(-18.5, 0);
    g.lineTo(-18.5, -43);
    g.arc(0, -43, 18.5, Math.PI, 0);
    g.lineTo(18.5, 0);
    g.strokeStyle = BLK;
    g.lineWidth = 3;
    g.stroke();
    steps(g, 0, 2, 38, 1, r);
    // the cap: a beaded rim and a shallow ribbed dome
    metal(
      g,
      r,
      () => bandPath(g, YT + 1, R + 11, 14),
      [-R - 11, YT - 13, R + 11, YT + 17],
      dark(RED, 0.18),
      { verd: 0.05, bare: 0.2, bareCol: "70,38,32", lw: 1.5 },
    );
    for (let a = 0.09; a < Math.PI; a += 0.112) {
      disc(
        g,
        Math.cos(a) * (R + 11),
        YT + 1 + Math.sin(a) * EY * 1.15 - 6.4,
        2.6,
      );
      g.fillStyle = dark(RED, 0.05);
      g.fill();
      ink(g, 0.7, 0.7);
      g.stroke();
    }
    metal(g, r, () => capPath(g), [-R - 7, YT - 66, R + 7, YT + 1], RED, {
      verd: 0.06,
      bare: 0.22,
      bareCol: "70,38,32",
      inside: () => {
        ink(g, 0.8, 0.4);
        for (let k = -6; k <= 6; k++) {
          const u = k / 6.6;
          const x = u * (R + 7);
          g.beginPath();
          g.moveTo(0, YT - 65);
          g.quadraticCurveTo(
            x * 0.9,
            YT - 60,
            x,
            YT - 13 + EY * Math.sqrt(1 - u * u),
          );
          g.stroke();
        }
        const hg = g.createRadialGradient(-28, YT - 48, 4, 0, YT - 28, 86);
        hg.addColorStop(0, "rgba(255,246,226,.3)");
        hg.addColorStop(0.5, "rgba(255,246,226,0)");
        hg.addColorStop(1, "rgba(24,16,12,.25)");
        g.fillStyle = hg;
        g.fillRect(-R - 7, YT - 66, 2 * R + 14, 70);
      },
    });
    g.beginPath();
    g.ellipse(0, YT - 65, 10, 3.6, 0, 0, TAU);
    g.fillStyle = BLK;
    g.fill();
    ink(g, 1);
    g.stroke();
    seg(g, 0, YT - 66, 0, YT - 72);
    bar(g, 4, BLK, null);
    disc(g, 0, YT - 73, 4.2);
    g.fillStyle = BLK;
    g.fill();
    ink(g, 1);
    g.stroke();
    // the signal arm's bracket
    g.fillStyle = BLK;
    g.fillRect(R - 4, FLAG[1] - 10, 14, 20);
    ink(g, 1);
    g.strokeRect(R - 4, FLAG[1] - 10, 14, 20);
    rivet(g, R - 1, FLAG[1] - 7, 1);
    rivet(g, R - 1, FLAG[1] + 6, 1);
    // a sack barrow loaded with mail, a sack by the door
    const tx = 158;
    const ty = 30;
    castShadow(
      g,
      [
        [tx - 28, ty],
        [tx + 28, ty],
        [tx + 42, ty + 7],
        [tx - 14, ty + 7],
      ],
      0.28,
    );
    seg(g, tx + 23, ty - 11, tx + 49, ty - 44);
    bar(g, 3, "#6e573f", "rgba(255,240,210,.3)");
    seg(g, tx + 43, ty - 45, tx + 56, ty - 42);
    bar(g, 3, "#4a443c", null);
    // the barrow's bed, seen from above (the sacks stand on it)
    oblique.onTop(g, ty - 11, () => {
      g.fillStyle = "#6a563e";
      g.fillRect(tx - 28, 0, 54, 9);
      ink(g, 0.9, 0.7);
      g.strokeRect(tx - 28, 0, 54, 9);
    });
    sack(g, tx - 12, ty - 10, 11, r);
    sack(g, tx + 10, ty - 10, 10.5, r);
    sack(g, tx - 1, ty - 26, 10, r);
    planks(g, tx - 28, ty - 11, tx + 26, ty - 5, r, {
      base: "#7d6648",
      vertical: false,
      pw: 6,
    });
    for (const x of [tx - 17, tx + 14]) {
      disc(g, x, ty - 4, 7.4);
      g.fillStyle = "#5a4a38";
      g.fill();
      ink(g, 1.2);
      g.stroke();
      disc(g, x, ty - 4, 2.2);
      g.fillStyle = IRON;
      g.fill();
      ink(g, 0.6, 0.7);
      for (let a = 0; a < Math.PI; a += Math.PI / 4) {
        seg(
          g,
          x - Math.cos(a) * 7,
          ty - 4 - Math.sin(a) * 7,
          x + Math.cos(a) * 7,
          ty - 4 + Math.sin(a) * 7,
        );
        g.stroke();
      }
    }
    sack(g, -62, 13, 11, r);
    moss(g, -80, 80, 1, r, 16);
    tufts(g, -132, -44, 20, r, 11);
    tufts(g, 52, 138, 28, r, 10);
    ivy(g, -68, -8, -92, r, 14);
    for (const [x, y, z, k] of [
      [-146, 6, 15, 1],
      [102, -24, 12, 0],
      [-110, 44, 10, 2],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    // each letter that lands in the slot (they fly in `ambient`) sends the signal arm up
    let up = 0;
    for (const [P, ph] of STREAMS) {
      const c = (t + ph) % P;
      if (c / FLY >= 1)
        up = Math.max(
          up,
          sstep((c - FLY) / 0.45) * (1 - sstep((c - FLY - 2.4) / 1.4)),
        );
    }
    const [fx, fy] = FLAG;
    g.save();
    g.translate(fx, fy);
    g.rotate(
      0.55 -
        (0.55 + Math.PI / 2 - 0.14) * up +
        0.05 * Math.sin(t * 9) * up * (1 - up) * 4,
    );
    g.fillStyle = accent(s.hue);
    g.fillRect(20, -16, 19, 14);
    g.strokeStyle = INK;
    g.lineWidth = 1;
    g.lineJoin = "round";
    g.strokeRect(20, -16, 19, 14);
    g.fillStyle = "rgba(60,40,20,.25)";
    g.fillRect(20, -6, 19, 4);
    seg(g, 0, 0, 39, 0);
    bar(g, 3.2, IRON, "rgba(220,220,210,.3)");
    g.restore();
    disc(g, fx, fy, 4);
    g.fillStyle = BRASS;
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1;
    g.stroke();
    // the lamp behind the slot and the portholes
    if (s.night || s.dusk) {
      g.save();
      g.globalCompositeOperation = "lighter";
      const f = 0.6 + 0.25 * Math.sin(t * 1.1) + 0.1 * Math.sin(t * 4.7);
      g.fillStyle = `rgba(255,190,110,${0.3 * f})`;
      g.fillRect(SLOT[0], SLOT[1], SLOT[2], SLOT[3]);
      g.restore();
    }
    glowPane(g, s, -46, -120, 9, null, 0.4);
    glowPane(g, s, 46, -120, 9, null, 2.2);
  },
  // what flies about it — the letters on the wind, the one that missed, the pigeon: never part of its shape
  ambient(g, s) {
    const t = s.t;
    // letters come in on the wind and slip into the slot
    STREAMS.forEach(([P, ph, side], i) => {
      const c = (t + ph) % P;
      const u = c / FLY;
      if (u >= 1) return;
      const k = sstep(u);
      const far = 1 - k;
      envelope(
        g,
        side * (122 - i * 14) * far ** 1.25,
        SLOT[1] +
          6 -
          (84 + i * 12) * far -
          34 * Math.sin(k * Math.PI) +
          Math.sin(t * 5 + i) * 3 * far,
        side * (0.5 + 0.4 * Math.sin(t * 3.3 + i * 2)) * far,
        1 + 0.4 * k,
        Math.min(1, u * 5),
        1 - 0.85 * sstep((u - 0.9) / 0.1),
      );
    });
    // a letter that missed, shifting on the paving in the gusts
    const lf = Math.max(0, gust(t, 2.6) - 0.45);
    envelope(
      g,
      76 + lf * 16,
      30 - lf * 9 * Math.abs(Math.sin(t * 2.3)),
      0.2 + lf * 1.4 * Math.sin(t * 1.9),
      1.2,
      1,
      0.62 + 0.38 * Math.min(1, lf * 2),
    );
    // the carrier pigeon: in with a letter, a rest on the finial, away again
    if (!s.night) {
      const c = t % 26;
      const [px, py] = PERCH;
      const col = "#9aa0a6";
      if (c < 3) {
        const k = sstep(c / 3);
        flier(
          g,
          px - 112 * (1 - k),
          py - 10 - 12 * (1 - k) - 12 * Math.sin(k * Math.PI),
          Math.sin(t * 11),
          col,
          Math.min(1, c * 2.5),
          true,
        );
      } else if (c < 16) {
        const q = c - 3;
        const pk =
          q > 5 && q < 6.2
            ? Math.max(0, Math.sin((q - 5) * 7.85))
            : q > 9 && q < 9.8
              ? Math.max(0, Math.sin((q - 9) * 7.85))
              : 0;
        bird(g, px, py, q > 7.5 ? -1 : 1, col, 1.35, pk);
        if (q < 1.2) {
          g.fillStyle = "#e9e0c6";
          g.fillRect(px + 9, py - 10, 7, 4.6);
          g.strokeStyle = INK;
          g.lineWidth = 0.7;
          g.strokeRect(px + 9, py - 10, 7, 4.6);
        }
      } else if (c < 19) {
        const k = sstep((c - 16) / 3);
        flier(
          g,
          px + 118 * k,
          py - 10 - 18 * k - 10 * Math.sin(k * Math.PI),
          Math.sin(t * 11),
          col,
          1 - sstep((k - 0.7) / 0.3),
          false,
        );
      }
    }
  },
};
