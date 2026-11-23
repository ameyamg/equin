// Places' building on Isle: the map-pin lighthouse — a riveted copper shell
// gone green, shaped like a map pin, its round leaded lantern the pin's eye,
// its point planted in a short stone shaft among slate rocks, on a worn
// flagstone compass rose. It is the app at work: now and then a pin drops onto
// the flagstone map and the route to it is dotted in stone by stone, the brass
// north arrow is knocked round and settles, the lamp turns behind the glass,
// and at dusk and night its two beams sweep the sea.

import {
  accent,
  castShadow,
  dark,
  doorArch,
  fittings,
  grain,
  hline,
  ink,
  jit,
  light,
  mix,
  moss,
  oblique,
  poly,
  shrub,
  steps,
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
  BRASS_L,
  VERDIGRIS,
  IRON,
  STONE,
  clamp01,
  disc,
  seg,
  ellShadow,
  bar,
  rivet,
  streaks,
  drum,
  rockLump,
  glowPane,
  cloth,
} = fittings;

const GRAIN_BOX: Box = [-280, -440, 280, 70];
/** The copper shell: the head's centre and radius, and where its point meets the stone shaft (y, half-width). */
const HY = -316;
const HR = 72;
const NY = -92;
const NW = 18;
const DD = Math.hypot(NW, NY - HY);
const OFF = Math.acos(HR / DD);
const T0 = Math.atan2(NY - HY, -NW) + OFF;
const T1 = Math.atan2(NY - HY, NW) - OFF;
/** The shoulder, where the taper meets the head. */
const SY = HY + HR * Math.sin(T0);
const SX = -HR * Math.cos(T0);
/** The shell's half-width at height `y` of the taper. */
const hw = (y: number) => NW + ((SX - NW) * (NY - y)) / (NY - SY);
function body(g: Ctx2D): void {
  g.beginPath();
  g.moveTo(-NW, NY);
  g.lineTo(-SX, SY);
  g.arc(0, HY, HR, T0, T1 + TAU);
  g.lineTo(NW, NY);
  g.quadraticCurveTo(0, NY + 10, -NW, NY);
  g.closePath();
}
/** The flagstone compass rose: its centre and radii, and a point of it. */
const RC: Pt = [0, -8];
const RX = 150;
const RY = 48;
const pt = (a: number, k: number): Pt => [
  RC[0] + Math.cos(a) * RX * k,
  RC[1] + Math.sin(a) * RY * k,
];
/** The flagpole (foot x, foot y, height), the lantern's radius, the north arrow's height. */
const FLAG = [184, -10, 48] as const;
const LR = 33;
const VANE_Y = HY - HR - 20;
/** The places saved on the flagstone map, in the order they are pinned, and the rhythm of it. */
const SAVED: readonly Pt[] = [
  [-46, 28],
  [32, 34],
  [86, 20],
  [128, 2],
  [126, -28],
];
const SLOT = 4.6;
const FALL = 0.7;
const CYCLE = (SAVED.length + 2) * SLOT;
const PIN_CLOTH = ["#9a5a48", "#b5a47a"] as const;

/** A small map pin standing on (x, y), `drop` px still above it, at opacity `a`. */
function mapPin(
  g: Ctx2D,
  x: number,
  y: number,
  drop: number,
  col: string,
  a: number,
): void {
  g.globalAlpha = a;
  g.fillStyle = `rgba(34,40,22,${0.34 * (1 - drop / 44)})`;
  g.beginPath();
  g.ellipse(x + 3.2, y + 1, 5.5, 2, 0, 0, TAU);
  g.fill();
  const yy = y - drop;
  g.beginPath();
  g.moveTo(x, yy);
  g.lineTo(x - 4.3, yy - 9.9);
  g.arc(x, yy - 12.2, 5, 2.6, 0.54);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 0.9;
  g.lineJoin = "round";
  g.stroke();
  g.fillStyle = "rgba(255,246,220,.75)";
  disc(g, x, yy - 12.2, 1.6);
  g.fill();
  g.globalAlpha = 1;
}

export const lighthouse: BuildingSpec = {
  door: { kind: "leaf", w: 32, h: 56, arch: true },
  footprint: {
    w: 190,
    depth: 96,
    ground: [-153, -112, 206, 51],
    upper: [-75, -418, 75, -112],
  },
  setting: ["coast", "cape"],
  signX: -150,
  lights: [
    [0, HY, 34],
    [0, -34, 14],
    [0, -208, 9],
    [0, -142, 9],
  ],
  paint(g, s) {
    const r = s.rnd;
    const lit = s.night;
    const A = accent(s.hue);
    const V = mix(A, VERDIGRIS, 0.5);
    // a worn flagstone compass rose around the foot: the map the places are pinned on
    wash(
      g,
      () => {
        g.beginPath();
        g.ellipse(RC[0], RC[1], RX, RY, 0, 0, TAU);
      },
      [-RX, RC[1] - RY, RX, RC[1] + RY],
      "#aaa391",
      r,
      { blob: 10, var: 26, shadeA: 0.14, lw: 1.4 },
    );
    g.save();
    g.beginPath();
    g.ellipse(RC[0], RC[1], RX, RY, 0, 0, TAU);
    g.clip();
    for (const [j, k0, k1, n] of [
      [0, 0.4, 0.62, 14],
      [1, 0.62, 0.82, 22],
      [2, 0.82, 1, 30],
    ] as const) {
      ink(g, 0.7, 0.4);
      g.beginPath();
      g.ellipse(RC[0], RC[1], RX * k0, RY * k0, 0, 0, TAU);
      g.stroke();
      for (let i = 0; i < n; i++) {
        const a = ((i + (j % 2) * 0.5 + r() * 0.2) * TAU) / n;
        const p = pt(a, k0);
        const q = pt(a, k1);
        hline(g, p[0], p[1], q[0], q[1], r, 0.6);
      }
    }
    // (the rose's points lie flat on the round paving: no receding edge of a volume among them)
    oblique.diagonal(g, () => {
      for (let pass = 0; pass < 2; pass++)
        for (let i = 0; i < 8; i++) {
          if ((i % 2 === 1) !== (pass === 0)) continue;
          const a = (i * Math.PI) / 4 - Math.PI / 2;
          const len = i % 2 ? 0.52 : 0.8;
          const tip = pt(a, len);
          const l = pt(a - 0.42, 0.22);
          const rr = pt(a + 0.42, 0.22);
          g.fillStyle = jit(i % 2 ? "#8f7460" : "#62666a", r, 14);
          poly(g, [RC, l, tip]);
          g.fill();
          g.fillStyle = jit("#c6bea8", r, 12);
          poly(g, [RC, tip, rr]);
          g.fill();
          ink(g, 0.8, 0.6);
          poly(g, [RC, l, tip, rr]);
          g.stroke();
          hline(g, RC[0], RC[1], tip[0], tip[1], r, 0.3);
        }
    });
    for (let k = 0; k < 56; k++) {
      const a = r() * TAU;
      const d = 0.55 + r() * 0.45;
      const p = pt(a, d);
      g.fillStyle = r() < 0.5 ? "rgba(98,112,58,.4)" : "rgba(60,54,44,.14)";
      g.beginPath();
      g.ellipse(p[0], p[1], 3 + r() * 7, 1.5 + r() * 3, 0, 0, TAU);
      g.fill();
    }
    g.restore();
    // the pin's own shadow, long across the paving: a stalk as broad as the shaft from its foot, so the head's shadow out on the grass reads as joined to it
    castShadow(
      g,
      [
        [-30, 6],
        [38, -3],
        [126, 15],
        [140, 10],
        [166, 10],
        [182, 22],
        [178, 36],
        [156, 42],
        [132, 37],
        [112, 34],
      ],
      0.24,
    );
    // the rocks the tower stands on, and its stone shaft
    for (const [x, y, sz] of [
      [-42, -46, 24],
      [46, -48, 24],
      [-84, -24, 26],
      [88, -26, 28],
    ] as const)
      rockLump(g, x, y, sz, r);
    drum(g, r, {
      rb: 42,
      rt: 24,
      yb: -8,
      yt: NY - 6,
      ey: 10,
      row: 9,
      joint: 0.3,
      top: null,
      tone: STONE,
    });
    // the copper shell: riveted sheets gone green, copper showing where the weather comes from
    g.save();
    body(g);
    g.clip();
    const gr = g.createLinearGradient(-HR, 0, HR, 0);
    gr.addColorStop(0, light(V, 0.2));
    gr.addColorStop(0.4, V);
    gr.addColorStop(1, dark(V, 0.42));
    g.fillStyle = gr;
    g.fillRect(-HR, HY - HR, 2 * HR, NY - HY + HR + 12);
    for (let i = 0; i < 320; i++) {
      const k = r();
      g.fillStyle =
        k < 0.16
          ? `rgba(150,96,58,${0.14 + r() * 0.2})`
          : k < 0.3
            ? `rgba(200,222,204,${0.08 + r() * 0.1})`
            : jit(V, r, 38, 0.22);
      g.beginPath();
      g.ellipse(
        -HR + r() * 2 * HR,
        HY - HR + r() * (NY - HY + HR),
        4 + r() * 9,
        2 + r() * 6,
        r() * 3,
        0,
        TAU,
      );
      g.fill();
    }
    for (let y = NY - 16; y > SY - 6; y -= 24) {
      const w = hw(y) + 1;
      ink(g, 0.8, 0.42);
      g.beginPath();
      g.moveTo(-w, y);
      g.quadraticCurveTo(0, y + w * 0.34, w, y);
      g.stroke();
      for (let k = -3; k <= 3; k++) {
        const u = k / 3.4;
        rivet(g, u * w, y + w * 0.17 * (1 - u * u) * 2 - 3.2, 0.9);
      }
    }
    ink(g, 0.8, 0.38);
    for (const k of [-0.62, 0.62, 0.2]) {
      g.beginPath();
      g.ellipse(
        0,
        HY,
        HR * Math.abs(k),
        HR,
        0,
        k < 0 ? Math.PI / 2 : -Math.PI / 2,
        k < 0 ? Math.PI * 1.5 : Math.PI / 2,
      );
      g.stroke();
    }
    g.beginPath();
    g.ellipse(0, HY - 9, HR * 0.99, 19, 0, 0, Math.PI);
    g.stroke();
    g.beginPath();
    g.ellipse(0, HY + 43, HR * 0.82, 15, 0, 0, Math.PI);
    g.stroke();
    for (let a = 0.2; a < Math.PI; a += 0.22) {
      rivet(g, Math.cos(a) * HR * 0.99, HY - 9 + Math.sin(a) * 19 - 3, 0.9);
      rivet(g, Math.cos(a) * HR * 0.82, HY + 43 + Math.sin(a) * 15 - 3, 0.9);
    }
    streaks(g, r, [-HR, HY - 30, HR, NY], 34, "34,48,40", 0.14, 60);
    streaks(g, r, [-HR, HY - 10, HR, NY], 16, "206,226,208", 0.1, 44);
    const sh = g.createRadialGradient(-26, HY - 26, 6, 4, HY + 4, HR * 1.12);
    sh.addColorStop(0, "rgba(255,252,236,.2)");
    sh.addColorStop(0.5, "rgba(255,252,236,0)");
    sh.addColorStop(1, "rgba(255,252,236,0)");
    g.fillStyle = sh;
    g.fillRect(-HR, HY - HR, 2 * HR, 2 * HR + 6);
    g.restore();
    body(g);
    ink(g, 1.7);
    g.stroke();
    // a corbelled stone ring under the point
    g.fillStyle = "#a9a18f";
    g.beginPath();
    g.ellipse(0, NY + 6, 28, 8, 0, 0, TAU);
    g.fill();
    ink(g, 1.2);
    g.stroke();
    g.save();
    g.beginPath();
    g.rect(-44, NY - 8, 88, 16);
    g.clip();
    body(g);
    g.fillStyle = dark(V, 0.36);
    g.fill();
    ink(g, 1.4);
    g.stroke();
    g.restore();
    g.beginPath();
    g.ellipse(0, NY + 6, 28, 8, 0, 0.02, Math.PI - 0.02);
    bar(g, 4, "#a39c8b", "rgba(255,250,235,.35)");
    // the lantern: a round leaded window in an iron frame, the lamp behind it
    disc(g, 0, HY, LR + 5);
    g.fillStyle = IRON;
    g.fill();
    ink(g, 1.4);
    g.stroke();
    disc(g, 0, HY, LR + 2.5);
    g.strokeStyle = "rgba(170,160,140,.4)";
    g.lineWidth = 1;
    g.stroke();
    for (let k = 0; k < 18; k++) {
      const a = (k * TAU) / 14;
      g.fillStyle = BRASS;
      g.fillRect(
        Math.cos(a) * (LR + 2.6) - 0.9,
        HY + Math.sin(a) * (LR + 2.6) - 0.9,
        1.8,
        1.8,
      );
    }
    const gl = g.createLinearGradient(-LR, HY - LR, LR, HY + LR);
    if (lit) {
      gl.addColorStop(0, "#fff3c4");
      gl.addColorStop(1, "#f2c25e");
    } else {
      gl.addColorStop(0, "#c9dde2");
      gl.addColorStop(0.55, "#93abb0");
      gl.addColorStop(1, "#66808a");
    }
    disc(g, 0, HY, LR);
    g.fillStyle = gl;
    g.fill();
    ink(g, 1.1);
    g.stroke();
    g.save();
    disc(g, 0, HY, LR);
    g.clip();
    g.fillStyle = "rgba(40,50,56,.35)";
    g.beginPath();
    g.ellipse(0, HY + LR + 5, LR, 14, 0, 0, TAU);
    g.fill();
    g.fillStyle = lit ? "#fffbe6" : "#e9dca6";
    g.beginPath();
    g.ellipse(0, HY + 1, 9, 13.5, 0, 0, TAU);
    g.fill();
    ink(g, 0.9, 0.7);
    g.stroke();
    g.fillStyle = "#4a443c";
    g.fillRect(-4.4, HY + 14, 8.8, 20);
    g.strokeStyle = IRON;
    g.lineWidth = 1.4;
    for (const k of [-21, -10.5, 0, 10.5, 21]) {
      seg(g, k, HY - LR, k, HY + LR);
      g.stroke();
    }
    g.lineWidth = 1.2;
    for (const k of [-14, 13]) {
      seg(g, -LR, HY + k, LR, HY + k);
      g.stroke();
    }
    if (!lit) {
      g.strokeStyle = "rgba(255,255,255,.3)";
      g.lineWidth = 2.4;
      g.beginPath();
      g.arc(0, HY, LR - 4, 3.5, 4.4);
      g.stroke();
    }
    g.restore();
    // the finial the north arrow turns on
    seg(g, 0, HY - HR, 0, VANE_Y - 5);
    bar(g, 2.2, BRASS, BRASS_L);
    disc(g, 0, HY - HR - 8, 4.2);
    g.fillStyle = BRASS;
    g.fill();
    ink(g, 1);
    g.stroke();
    // windows, door
    windowRect(g, -7, -196, 14, 24, r, {
      arch: true,
      lit,
      sill: BRASS_D,
      frame: "#3f4a40",
    });
    windowRect(g, -6, -132, 12, 20, r, {
      arch: true,
      lit,
      sill: BRASS_D,
      frame: "#3f4a40",
    });
    doorArch(g, 0, 0, 32, 56, r, { col: A });
    steps(g, 0, 3, 36, 2, r);
    for (const [x, y, sz] of [
      [-62, 8, 24],
      [64, 10, 26],
    ] as const)
      rockLump(g, x, y, sz, r);
    moss(g, -80, 80, 5, r, 14);
    // the flagpole
    ellShadow(g, FLAG[0] + 8, FLAG[1] + 1.5, 10, 2.8, 0.23);
    seg(g, FLAG[0], FLAG[1], FLAG[0], FLAG[1] - FLAG[2]);
    bar(g, 2, "#7a6548", "rgba(255,240,210,.3)");
    tufts(g, -54, 54, 2, r, 10);
    tufts(g, 156, 196, 30, r, 7);
    for (const [x, y, z, k] of [
      [-134, -34, 13, 1],
      [142, -40, 13, 0],
    ] as const)
      shrub(g, x, y, z, r, k);
    grain(g, GRAIN_BOX, r);
  },
  animate(g, s) {
    const t = s.t;
    const c = t % CYCLE;
    const slot = Math.floor(c / SLOT);
    // the brass north arrow: knocked round each time a pin lands, it swings and settles back on north
    const since = c - (Math.min(slot, SAVED.length - 1) * SLOT + FALL);
    const va =
      (since > 0
        ? 1.25 * Math.exp(-0.8 * since) * Math.cos(3.6 * since)
        : 0.05) +
      0.07 * Math.sin(t * 0.6);
    const vk = Math.cos(va);
    const ar = (x: number) => x * vk;
    g.save();
    g.lineJoin = "round";
    g.lineCap = "round";
    seg(g, ar(-15), VANE_Y, ar(13), VANE_Y);
    g.strokeStyle = "rgba(48,38,28,.88)";
    g.lineWidth = 4.2;
    g.stroke();
    g.strokeStyle = BRASS;
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = BRASS;
    g.strokeStyle = INK;
    g.lineWidth = 1;
    poly(g, [
      [ar(12), VANE_Y - 5],
      [ar(22), VANE_Y],
      [ar(12), VANE_Y + 5],
    ]);
    g.fill();
    g.stroke();
    poly(g, [
      [ar(-15), VANE_Y - 4],
      [ar(-20), VANE_Y - 4],
      [ar(-17), VANE_Y],
      [ar(-20), VANE_Y + 4],
      [ar(-15), VANE_Y + 4],
    ]);
    g.fill();
    g.stroke();
    g.restore();
    // the lamp turning behind the glass: a soft pulse by day, the beams after sunset
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.4);
    g.save();
    disc(g, 0, HY, LR - 1);
    g.clip();
    const lg = g.createRadialGradient(0, HY, 2, 0, HY, LR);
    lg.addColorStop(
      0,
      `rgba(255,246,206,${(s.night || s.dusk ? 0.55 : 0.3) * pulse})`,
    );
    lg.addColorStop(1, "rgba(255,246,206,0)");
    g.fillStyle = lg;
    g.fillRect(-LR, HY - LR, 2 * LR, 2 * LR);
    g.restore();
    glowPane(g, s, -5, -218, 10, 20, 0.8);
    // the two beams sweeping the sea: light (`lighter`), never part of the footprint
    if (s.dusk || s.night) {
      const a = t * 0.7;
      const L = 300;
      g.save();
      g.globalCompositeOperation = "lighter";
      for (const b of [a, a + Math.PI]) {
        const facing = 0.5 + 0.5 * Math.sin(b);
        // drawn in the flattened space the beam turns in, so it fades out along its whole length (not cut off where it is foreshortened)
        g.save();
        g.translate(0, HY);
        g.scale(1, 0.45);
        const gr = g.createRadialGradient(0, 0, 4, 0, 0, L);
        gr.addColorStop(0, `rgba(255,240,190,${0.32 + 0.25 * facing})`);
        gr.addColorStop(1, "rgba(255,240,190,0)");
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, L, b - 0.12, b + 0.12);
        g.closePath();
        g.fill();
        g.restore();
      }
      g.restore();
    }
  },
  // the pins and the dotted route on the flagstone map: small things on the ground, never part of the tower's shape
  ambient(g, s) {
    const c = s.t % CYCLE;
    // the faded pennant on the survey pole out on the grass: a loose prop's flag, not the tower's
    cloth(g, FLAG[0] + 1, FLAG[1] - FLAG[2] + 2, 18, 12, s.t, 0, "#9a5a48");
    const slot = Math.floor(c / SLOT);
    const fade = clamp01((CYCLE - c) / 1.2);
    // places being saved: a pin dropped on the flagstone map now and then, the
    // route to it dotted in stone by stone, then the map cleared
    g.fillStyle = `rgba(112,58,44,${0.85 * fade})`;
    for (let i = 1; i < SAVED.length; i++) {
      const a = SAVED[i - 1]!;
      const b = SAVED[i]!;
      const shown = Math.floor((c - (i * SLOT + FALL)) / 0.42);
      for (let k = 1; k <= Math.min(5, shown); k++) {
        g.beginPath();
        g.ellipse(
          a[0] + ((b[0] - a[0]) * k) / 6,
          a[1] + ((b[1] - a[1]) * k) / 6 + Math.sin((k / 6) * Math.PI) * 2.5,
          2.6,
          1.3,
          0,
          0,
          TAU,
        );
        g.fill();
      }
    }
    SAVED.forEach(([x, y], i) => {
      if (i > slot) return;
      const u = i === slot ? clamp01((c - i * SLOT) / FALL) : 1;
      const col = i % 3 === 2 ? accent(s.hue) : PIN_CLOTH[i % 3 === 1 ? 1 : 0];
      mapPin(g, x, y, 44 * (1 - u * u), col, fade * Math.min(1, u * 4));
    });
  },
};
