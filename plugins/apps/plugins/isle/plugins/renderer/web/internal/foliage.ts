// The island's trees and bushes, in the buildings' medium: a tapered trunk
// with bark and roots, boughs forking up into a dark crown with gaps the sky
// shows through, scalloped masses of leaves lit from the upper left, a fine
// broken ink line, a leafy shadow cast to the lower right, granulation.
// Thirteen trees — eight broadleaves from sapling to old oak, three conifers,
// two in autumn colour — in the order the furniture indexes them, each painted
// from its own seeded stream when a tile first shows it (`lazySprite`).

import {
  footGrass,
  grain,
  lazySprite,
  pen,
  penLine,
  seeded,
  strHash,
  tone,
  type Ctx,
  type Rnd,
  type Sprite,
  type SpriteBox,
} from "./kit";

type Palette = readonly [string, string, string, string, string];
type Bark = readonly [string, string, string];
type Pt = readonly [number, number];

/** Leaves, from the crown's dark inside to its highlights. */
const LEAF = {
  oak: ["#29341f", "#3b492a", "#546239", "#75824a", "#9da364"],
  beech: ["#2d3923", "#42502f", "#5c6b3d", "#808c4f", "#a7ac6a"],
  birch: ["#38422a", "#525d31", "#717c40", "#959c54", "#babb78"],
  spruce: ["#1f2c22", "#2c3d2e", "#3f533c", "#5a6e4c", "#7c8c62"],
  pine: ["#232f27", "#314135", "#435643", "#5d6f50", "#808d64"],
  russet: ["#44311f", "#5d4227", "#7a5830", "#96743f", "#b4955a"],
  gold: ["#524422", "#6d5d2b", "#8c7a38", "#aa964c", "#c6b370"],
} as const satisfies Record<string, Palette>;

/** Bark: its body, its shaded side, its lit side. */
const BARK = {
  oak: ["#5d4c39", "#392d21", "#806d55"],
  beech: ["#6e6758", "#444035", "#928b79"],
  birch: ["#d3cfc0", "#8c887b", "#ece9dd"],
  pine: ["#866046", "#51382a", "#ac8463"],
  spruce: ["#514335", "#30271e", "#6e5c49"],
} as const satisfies Record<string, Bark>;

interface Lobe {
  readonly p0: Pt;
  readonly c: Pt;
  readonly p1: Pt;
  /** The lobe's direction from the mass's centre. */
  readonly am: number;
}

/** A mass of leaves: a scalloped shape round an ellipse. */
interface Mass {
  readonly P: Path2D;
  readonly lobes: readonly Lobe[];
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

function leafMass(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rnd: Rnd,
  lobe = 11,
): Mass {
  const n = Math.max(6, Math.round((Math.PI * (rx + ry)) / lobe));
  const a0 = rnd() * 7;
  const pt = (a: number, k: number): Pt => [
    cx + Math.cos(a) * rx * k,
    cy + Math.sin(a) * ry * k,
  ];
  const J: [number, number][] = [];
  for (let i = 0; i < n; i++)
    J.push([
      a0 + ((i + (rnd() - 0.5) * 0.5) / n) * Math.PI * 2,
      0.84 + rnd() * 0.1,
    ]);
  const lobes: Lobe[] = [];
  for (let i = 0; i < n; i++) {
    const [a, k] = J[i]!;
    const [b0, k1] = J[(i + 1) % n]!;
    const b = i === n - 1 ? b0 + Math.PI * 2 : b0;
    const am = (a + b) / 2;
    lobes.push({
      p0: pt(a, k),
      c: pt(am, 1.14 + rnd() * 0.24),
      p1: pt(b, k1),
      am,
    });
  }
  const P = new Path2D();
  P.moveTo(lobes[0]!.p0[0], lobes[0]!.p0[1]);
  for (const l of lobes) P.quadraticCurveTo(l.c[0], l.c[1], l.p1[0], l.p1[1]);
  P.closePath();
  return { P, lobes, cx, cy, rx, ry };
}

interface MassLook {
  /** The crown's dark inside. */
  readonly back?: boolean;
  /** Mass area per leaf dab. */
  readonly dab?: number;
  /** Dabs stretched sideways (needles). */
  readonly stretch?: number;
}

/**
 * Paints a mass: washed light above and dark below, dabbed with leaves, inked
 * (heavier in its shadow, broken in its light). `lit`: how much of the crown's
 * light it gets (-1 its shadow side … 1 its lit side).
 */
function paintMass(
  g: Ctx,
  m: Mass,
  pal: Palette,
  rnd: Rnd,
  lit: number,
  o: MassLook = {},
): void {
  const R = Math.max(m.rx, m.ry);
  g.save();
  g.fillStyle = pal[o.back ? 0 : 2];
  g.fill(m.P);
  g.clip(m.P);
  if (!o.back) {
    const gr = g.createRadialGradient(
      m.cx - m.rx * 0.4,
      m.cy - m.ry * 0.55,
      R * 0.1,
      m.cx - m.rx * 0.1,
      m.cy - m.ry * 0.15,
      R * 1.45,
    );
    gr.addColorStop(0, tone(pal[3], Math.max(0, Math.min(1, 0.7 + lit * 0.3))));
    gr.addColorStop(0.5, tone(pal[2], 0));
    gr.addColorStop(1, tone(pal[0], 0.9));
    g.fillStyle = gr;
    g.fillRect(m.cx - R * 1.5, m.cy - R * 1.5, R * 3, R * 3);
  }
  const n = (m.rx * m.ry * 3.14) / (o.dab ?? 12);
  const sx = o.stretch ?? 1;
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.283;
    const d = Math.sqrt(rnd());
    const ux = Math.cos(a) * d;
    const uy = Math.sin(a) * d;
    const x = m.cx + ux * m.rx * 1.12;
    const y = m.cy + uy * m.ry * 1.12;
    const t =
      ((-ux * 0.5 - uy * 0.82) * 0.5 + 0.5) * 0.72 +
      lit * 0.3 +
      (rnd() - 0.5) * 0.42;
    const idx = o.back
      ? t > 0.62
        ? 1
        : 0
      : t < 0.2
        ? 0
        : t < 0.42
          ? 1
          : t < 0.66
            ? 2
            : t < 0.9
              ? 3
              : 4;
    g.fillStyle = tone(pal[idx], 0.88);
    g.beginPath();
    g.ellipse(
      x,
      y,
      (1.3 + rnd() * 1.7) * sx,
      0.8 + rnd() * 1.0,
      sx > 1 ? (rnd() - 0.5) * 0.5 : rnd() * 3.1,
      0,
      7,
    );
    g.fill();
  }
  if (!o.back) {
    // the leaf clumps' own little shadows
    g.strokeStyle = tone(pal[0], 0.5);
    g.lineWidth = 0.9;
    for (let i = 0; i < n / 22; i++) {
      const a = rnd() * 6.283;
      const d = Math.sqrt(rnd()) * 0.75;
      const x = m.cx + Math.cos(a) * d * m.rx + m.rx * 0.12;
      const y = m.cy + Math.sin(a) * d * m.ry + m.ry * 0.15;
      const r = 2.5 + rnd() * 3.5;
      g.beginPath();
      g.arc(x, y, r, 0.3 + rnd() * 0.4, 2.2 + rnd() * 0.6);
      g.stroke();
    }
  }
  g.restore();
  g.lineCap = "round";
  for (const l of m.lobes) {
    const s = Math.cos(l.am) * 0.55 + Math.sin(l.am) * 0.83; // > 0: the lower right, in shadow
    if (o.back ? rnd() < 0.3 : s < -0.25 && rnd() < 0.4) continue;
    g.strokeStyle = pen(s > 0 ? 0.78 : 0.5);
    g.lineWidth = s > 0 ? 1.15 : 0.8;
    g.beginPath();
    g.moveTo(l.p0[0], l.p0[1]);
    g.quadraticCurveTo(
      l.c[0] + (rnd() - 0.5),
      l.c[1] + (rnd() - 0.5),
      l.p1[0],
      l.p1[1],
    );
    g.stroke();
  }
}

/** The shadow a crown casts on the ground, to the lower right: one leafy-edged shape (a single fill, so an even wash). */
function castShadow(g: Ctx, rnd: Rnd, cw: number, tw: number, len = 1): void {
  const sh = new Path2D();
  const sx = cw * 0.34 * len;
  const sy = cw * 0.075;
  for (let i = 0; i < 7; i++) {
    const a = rnd() * 7;
    const d = rnd() * 0.5;
    sh.addPath(
      leafMass(
        sx + Math.cos(a) * d * cw * 0.5 * len,
        sy + Math.sin(a) * d * cw * 0.12,
        cw * (0.2 + rnd() * 0.14) * len,
        cw * (0.075 + rnd() * 0.035),
        rnd,
        9,
      ).P,
    );
  }
  sh.moveTo(-tw * 0.4, 0.5);
  sh.lineTo(sx * 0.7, sy * 0.5 - 2);
  sh.lineTo(sx * 0.7, sy * 0.5 + 4);
  sh.lineTo(tw * 0.5, 3.5);
  sh.closePath();
  g.fillStyle = "rgba(34,40,24,.27)";
  g.fill(sh);
}

interface TrunkSpec {
  readonly h: number;
  /** Its width at the foot and at the top. */
  readonly w0: number;
  readonly w1: number;
  readonly lean: number;
  readonly flare: number;
  readonly bark: Bark;
  readonly birch?: boolean;
}

/** A trunk from the ground up → where its axis runs (x at height fraction t). */
function trunk(g: Ctx, rnd: Rnd, T: TrunkSpec): (t: number) => number {
  const N = 7;
  const L: [number, number][] = [];
  const Rr: [number, number][] = [];
  const bend = rnd() * 6;
  const axis = (t: number) =>
    T.lean * Math.pow(t, 1.4) + Math.sin(t * 3.1 + bend) * T.w0 * 0.14 * t;
  const widthAt = (t: number) => T.w1 + (T.w0 - T.w1) * Math.pow(1 - t, 1.5);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = -T.h * t;
    const w = widthAt(t) + T.flare * Math.pow(1 - t, 6);
    const cx = axis(t);
    L.push([cx - (w / 2) * (i ? 1 : 1.12), y]);
    Rr.push([cx + (w / 2) * (i ? 1 : 1.25), y]);
  }
  const P = new Path2D();
  [...L, ...Rr.slice().reverse()].forEach(([x, y], i) =>
    i ? P.lineTo(x, y) : P.moveTo(x, y),
  );
  P.closePath();
  g.save();
  g.fillStyle = T.bark[0];
  g.fill(P);
  g.clip(P);
  for (let i = 0; i < N; i++) {
    const [lx, ly] = L[i]!;
    const [rx] = Rr[i]!;
    const [lx2, ly2] = L[i + 1]!;
    const [rx2] = Rr[i + 1]!;
    const wA = rx - lx;
    const wB = rx2 - lx2;
    g.fillStyle = tone(T.bark[1], 0.72);
    g.beginPath();
    g.moveTo(lx + wA * 0.6, ly);
    g.lineTo(rx + 1, ly);
    g.lineTo(rx2 + 1, ly2);
    g.lineTo(lx2 + wB * 0.6, ly2);
    g.closePath();
    g.fill();
    g.fillStyle = tone(T.bark[2], 0.6);
    g.beginPath();
    g.moveTo(lx - 1, ly);
    g.lineTo(lx + wA * 0.24, ly);
    g.lineTo(lx2 + wB * 0.24, ly2);
    g.lineTo(lx2 - 1, ly2);
    g.closePath();
    g.fill();
  }
  if (T.birch) {
    // a birch's dark dashes across its pale bark, and its black foot
    for (let y = -3; y > -T.h; y -= 3 + rnd() * 7) {
      const t = -y / T.h;
      const w = widthAt(t);
      const x = axis(t) - w / 2 + rnd() * w * 0.7;
      const len = w * (0.25 + rnd() * 0.45);
      g.strokeStyle = "rgba(38,34,28,.78)";
      g.lineWidth = 0.9 + rnd() * 0.9;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + len, y + (rnd() - 0.5));
      g.stroke();
    }
    g.fillStyle = "rgba(42,38,30,.6)";
    g.beginPath();
    g.moveTo(-T.w0, 1);
    g.lineTo(-T.w0 * 0.1, -T.h * 0.1);
    g.lineTo(T.w0 * 0.3, -T.h * 0.04);
    g.lineTo(T.w0, 1);
    g.closePath();
    g.fill();
  } else
    for (let i = 0; i < (T.h * T.w0) / 26; i++) {
      const t = rnd();
      const y = -T.h * t;
      const x = axis(t) + (rnd() - 0.5) * widthAt(t);
      const len = 3 + rnd() * 7;
      g.strokeStyle = rnd() < 0.7 ? "rgba(36,28,20,.38)" : tone(T.bark[2], 0.5);
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(
        x + (rnd() - 0.5) * 1.6,
        y - len / 2,
        x + (rnd() - 0.5),
        y - len,
      );
      g.stroke();
    }
  g.restore();
  penLine(g, L, rnd, 1.05, 0.78, 0.5);
  penLine(g, Rr, rnd, 1.2, 0.85, 0.5);
  // roots gripping the ground
  const l0 = L[0]![0];
  const r0 = Rr[0]![0];
  penLine(
    g,
    [
      [l0 + 0.5, -1],
      [l0 - T.w0 * 0.3, 1.2],
    ],
    rnd,
    1,
    0.7,
    0.3,
  );
  penLine(
    g,
    [
      [r0 - 0.5, -1],
      [r0 + T.w0 * 0.35, 1.6],
    ],
    rnd,
    1.1,
    0.8,
    0.3,
  );
  return axis;
}

/** A bough from a to b, reaching out then up, thinning; a couple of twigs. */
function limb(
  g: Ctx,
  rnd: Rnd,
  a: Pt,
  b: Pt,
  w: number,
  bark: Bark,
  twigs: number,
): void {
  const cx = a[0] + (b[0] - a[0]) * 0.62;
  const cy = a[1] + (b[1] - a[1]) * 0.22;
  const q = (t: number): Pt => [
    (1 - t) * (1 - t) * a[0] + 2 * t * (1 - t) * cx + t * t * b[0],
    (1 - t) * (1 - t) * a[1] + 2 * t * (1 - t) * cy + t * t * b[1],
  ];
  const seg = (t0: number, t1: number, lw: number, col: string, dy = 0) => {
    g.strokeStyle = col;
    g.lineWidth = lw;
    g.beginPath();
    for (let i = 0; i <= 6; i++) {
      const [x, y] = q(t0 + ((t1 - t0) * i) / 6);
      if (i) g.lineTo(x, y + dy);
      else g.moveTo(x, y + dy);
    }
    g.stroke();
  };
  g.lineCap = "round";
  g.lineJoin = "round";
  seg(0, 0.55, w + 1.6, pen(0.8));
  seg(0.5, 1, w * 0.55 + 1.4, pen(0.75));
  seg(0, 0.55, w, bark[0]);
  seg(0.5, 1, w * 0.55, bark[0]);
  seg(0, 0.9, Math.max(0.8, w * 0.32), tone(bark[1], 0.75), w * 0.22);
  seg(0.05, 0.8, Math.max(0.6, w * 0.2), tone(bark[2], 0.6), -w * 0.26);
  for (let i = 0; i < twigs; i++) {
    const [x, y] = q(0.45 + rnd() * 0.45);
    const dir = (b[0] > a[0] ? 1 : -1) * (rnd() < 0.7 ? 1 : -1);
    const len = 6 + rnd() * 9;
    g.strokeStyle = tone(bark[1], 0.9);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(
      x + dir * len * 0.3,
      y - len * 0.5,
      x + dir * len * 0.7,
      y - len,
    );
    g.stroke();
  }
}

/** A broadleaf (or a pine's flat crown on a tall bare trunk). */
interface Broadleaf {
  /** Its height, and its crown's width and height. */
  readonly h: number;
  readonly cw: number;
  readonly ch: number;
  /** Where the crown's underside hangs. */
  readonly trunkH: number;
  /** The trunk's width at the foot. */
  readonly tw: number;
  readonly lean: number;
  readonly pal: keyof typeof LEAF;
  readonly bark: keyof typeof BARK;
  /** Masses round the crown, and inside its upper half. */
  readonly n: number;
  readonly inner: number;
  /** A mass's size, as a fraction of the crown. */
  readonly size: number;
  /** A scallop's length along a mass's edge, px. */
  readonly lobe: number;
  /** The opening under the crown where the trunk enters, radians either side of straight down. */
  readonly gap: number;
  readonly twigs?: number;
  readonly core?: number;
  readonly taper?: number;
  /** How far up into the crown the trunk runs (fraction of its height). */
  readonly into?: number;
  readonly flat?: number;
  readonly stretch?: number;
  readonly shadow?: number;
}

function broadleaf(key: string, S: Broadleaf, fit: SpriteBox): Sprite {
  const cw = S.cw;
  const H = S.h;
  const L = cw * 0.6 + 8 + Math.abs(S.lean);
  const R = cw * 1.04 + 10;
  const T = H + 14;
  const B = cw * 0.22 + 10;
  const draw = (g: Ctx) => {
    const rnd = seeded(strHash(`isle:tree:${key}`));
    const pal = LEAF[S.pal];
    const bark = BARK[S.bark];
    castShadow(g, rnd, cw, S.tw, S.shadow ?? 1);
    const th = S.trunkH + S.ch * (S.into ?? 0.5);
    const rx = cw / 2;
    const ry = S.ch / 2;
    const cx = S.lean;
    const cy = -(S.trunkH + S.ch / 2);
    const flat = S.flat ?? 0.82;
    const look: MassLook = { stretch: S.stretch };
    const ms: {
      x: number;
      y: number;
      rx: number;
      ry: number;
      limb: boolean;
    }[] = [];
    for (let i = 0; i < S.n; i++) {
      const a =
        -Math.PI / 2 + ((i + 0.5 + (rnd() - 0.5) * 0.5) / S.n) * Math.PI * 2;
      const da = Math.abs(
        ((a - Math.PI / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI,
      );
      const f = 0.5 + (rnd() - 0.5) * 0.2;
      const s = S.size * (0.8 + rnd() * 0.42);
      if (da < S.gap) continue;
      ms.push({
        x: cx + Math.cos(a) * rx * f,
        y: cy + Math.sin(a) * ry * f,
        rx: cw * s,
        ry: S.ch * s * flat,
        limb: true,
      });
    }
    for (let i = 0; i < S.inner; i++) {
      const a = -Math.PI * (0.15 + (0.7 * (i + rnd())) / S.inner);
      const f = 0.1 + rnd() * 0.2;
      const s = S.size * (0.9 + rnd() * 0.3);
      ms.push({
        x: cx + Math.cos(a) * rx * f,
        y: cy + Math.sin(a) * ry * f,
        rx: cw * s,
        ry: S.ch * s * flat,
        limb: false,
      });
    }
    // the crown's dark inside
    const k = S.core ?? 0.92;
    for (const m of [
      leafMass(
        cx,
        cy - ry * 0.08,
        rx * 0.7 * k,
        ry * 0.68 * k,
        rnd,
        S.lobe * 1.2,
      ),
      leafMass(
        cx - rx * 0.22,
        cy + ry * 0.14,
        rx * 0.5 * k,
        ry * 0.42 * k,
        rnd,
        S.lobe,
      ),
      leafMass(
        cx + rx * 0.24,
        cy + ry * 0.12,
        rx * 0.5 * k,
        ry * 0.42 * k,
        rnd,
        S.lobe,
      ),
    ])
      paintMass(g, m, pal, rnd, -0.6, { ...look, back: true });
    // gaps the sky shows through, low in the crown where the boughs fork
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = "#000";
    for (const sd of [-1, 1, rnd() < 0.5 ? -1.9 : 1.9])
      g.fill(
        leafMass(
          cx + sd * rx * (0.2 + rnd() * 0.08),
          cy + ry * (0.3 + rnd() * 0.22),
          cw * (0.04 + rnd() * 0.035),
          S.ch * (0.035 + rnd() * 0.03),
          rnd,
          5,
        ).P,
      );
    g.restore();
    // the trunk and its boughs, running up into the crown
    const axis = trunk(g, rnd, {
      h: th,
      w0: S.tw,
      w1: S.tw * (S.taper ?? 0.5),
      lean: S.lean,
      flare: S.tw * 0.7,
      bark,
      birch: S.bark === "birch",
    });
    const top = cy - ry;
    const lw = S.tw * 0.42;
    for (const m of ms) {
      if (!m.limb && rnd() < 0.4) continue;
      const t = Math.max(
        0.5,
        Math.min(
          0.98,
          0.56 + 0.44 * (1 - (m.y - top) / (2 * ry)) + (rnd() - 0.5) * 0.12,
        ),
      );
      limb(
        g,
        rnd,
        [axis(t), -th * t],
        [m.x, m.y + m.ry * 0.25],
        lw * (1.25 - t * 0.6),
        bark,
        S.twigs ?? 2,
      );
    }
    // the lit masses, the lowest in front, each shading what is below it
    ms.sort((a, b) => a.y - b.y);
    for (const m of ms) {
      const M = leafMass(m.x, m.y, m.rx, m.ry, rnd, S.lobe);
      const lit = Math.max(
        -1,
        Math.min(1, (-(m.x - cx) / rx) * 0.55 - ((m.y - cy) / ry) * 0.75),
      );
      g.save();
      g.globalCompositeOperation = "source-atop";
      g.translate(2, 3.5);
      g.fillStyle = tone(pal[0], 0.5);
      g.fill(M.P);
      g.restore();
      paintMass(g, M, pal, rnd, lit, look);
    }
    // one glaze over the whole crown: warm light on its upper left, its lower right in shade
    g.save();
    g.globalCompositeOperation = "source-atop";
    const gr = g.createLinearGradient(
      cx - rx * 0.7,
      cy - ry * 0.9,
      cx + rx * 0.8,
      cy + ry * 0.9,
    );
    gr.addColorStop(0, "rgba(255,238,172,.15)");
    gr.addColorStop(0.45, "rgba(0,0,0,0)");
    gr.addColorStop(1, tone(pal[0], 0.3));
    g.fillStyle = gr;
    g.fillRect(cx - rx * 1.5, cy - ry * 1.5, rx * 3, ry * 2.55);
    g.restore();
    footGrass(g, rnd, S.tw);
    grain(g, -L, -T, L + R, T + B, rnd);
  };
  return lazySprite(L + R, T + B, L, T, draw, {
    fit,
    vis: [-cw / 2 - 4, -H - 4, cw / 2 + 4, 4],
  });
}

/** A spruce: tiers of drooping boughs, each lit on its left and dark where the tier above overhangs it. */
function spruce(
  key: string,
  S: { readonly h: number; readonly w: number; readonly tiers: number },
  fit: SpriteBox,
): Sprite {
  const w = S.w;
  const H = S.h;
  const pal = LEAF.spruce;
  const L = w * 0.6 + 8;
  const R = w * 0.95 + 10;
  const T = H + 14;
  const B = w * 0.2 + 10;
  const draw = (g: Ctx) => {
    const rnd = seeded(strHash(`isle:tree:${key}`));
    castShadow(g, rnd, w * 0.9, w * 0.1, 1.15);
    trunk(g, rnd, {
      h: H * 0.34,
      w0: w * 0.12,
      w1: w * 0.07,
      lean: 0,
      flare: w * 0.06,
      bark: BARK.spruce,
    });
    const n = S.tiers;
    const lean = (rnd() - 0.5) * w * 0.12;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const y = -H * 0.15 - H * 0.72 * t;
      const hw = (w / 2) * (1 - t * 0.84) * (0.9 + rnd() * 0.2);
      const th = ((H * 0.8) / n) * (2.1 - t * 0.5);
      const cx = lean * t;
      const ax = cx + (rnd() - 0.5) * 2;
      const ay = y - th;
      const nl = Math.max(3, Math.round(hw / 6));
      const droop = (u: number) => Math.pow(Math.abs(u), 1.7) * th * 0.2;
      const nx: Pt[] = [];
      // each lobe's control point: a bough's hanging tip
      const lob: Pt[] = [];
      for (let k = 0; k <= nl; k++) {
        const u = (k / nl) * 2 - 1;
        nx.push([cx + u * hw, y + droop(u) - 1 - rnd() * 2.5]);
      }
      for (let k = 0; k < nl; k++) {
        const u = ((k + 0.5) / nl) * 2 - 1;
        lob.push([cx + u * hw * 1.04 + u * 2, y + droop(u) + 7 + rnd() * 6]);
      }
      const first = nx[0]!;
      const last = nx[nl]!;
      const P = new Path2D();
      P.moveTo(ax, ay);
      P.quadraticCurveTo(cx - hw * 0.62, y - th * 0.42, first[0], first[1]);
      for (let k = 0; k < nl; k++)
        P.quadraticCurveTo(
          lob[k]![0],
          lob[k]![1],
          nx[k + 1]![0],
          nx[k + 1]![1],
        );
      P.quadraticCurveTo(cx + hw * 0.62, y - th * 0.42, ax, ay);
      P.closePath();
      g.save();
      g.translate(1.5, 3);
      g.globalCompositeOperation = "source-atop";
      g.fillStyle = tone(pal[0], 0.55);
      g.fill(P);
      g.restore();
      g.save();
      g.fillStyle = pal[1];
      g.fill(P);
      g.clip(P);
      const gr = g.createLinearGradient(cx - hw, 0, cx + hw, 0);
      gr.addColorStop(0, tone(pal[3], 0.6));
      gr.addColorStop(0.45, tone(pal[2], 0.25));
      gr.addColorStop(1, tone(pal[0], 0.75));
      g.fillStyle = gr;
      g.fillRect(cx - hw - 4, ay - 2, hw * 2 + 8, th + 20);
      const gs = g.createLinearGradient(0, ay, 0, y + 6);
      gs.addColorStop(0, tone(pal[0], 0.75));
      gs.addColorStop(0.5, tone(pal[0], 0.15));
      gs.addColorStop(1, tone(pal[3], 0.18));
      g.fillStyle = gs;
      g.fillRect(cx - hw - 4, ay - 2, hw * 2 + 8, th + 20);
      g.lineWidth = 1;
      for (let k = 0; k < (hw * th) / 9; k++) {
        const u = rnd() * 2 - 1;
        const v = rnd();
        const x = cx + u * hw * (0.15 + v * 0.85);
        const yy = ay + v * (th + 6);
        const tn = (-u * 0.5 + 0.5) * 0.7 + v * 0.35 + (rnd() - 0.5) * 0.4;
        g.strokeStyle = tone(
          pal[tn < 0.3 ? 0 : tn < 0.55 ? 1 : tn < 0.8 ? 2 : tn < 1 ? 3 : 4],
          0.85,
        );
        g.beginPath();
        g.moveTo(x, yy);
        g.lineTo(x + u * 2.6 + (rnd() - 0.5), yy + 2.2 + rnd() * 1.6);
        g.stroke();
      }
      g.restore();
      g.lineCap = "round";
      g.lineJoin = "round";
      for (let k = 0; k < nl; k++) {
        const sh = k >= nl / 2;
        if (!sh && rnd() < 0.2) continue;
        g.strokeStyle = pen(sh ? 0.8 : 0.6);
        g.lineWidth = sh ? 1.15 : 0.9;
        g.beginPath();
        g.moveTo(nx[k]![0], nx[k]![1]);
        g.quadraticCurveTo(
          lob[k]![0] + (rnd() - 0.5),
          lob[k]![1] + (rnd() - 0.5),
          nx[k + 1]![0],
          nx[k + 1]![1],
        );
        g.stroke();
      }
      g.strokeStyle = pen(0.42);
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(ax, ay);
      g.quadraticCurveTo(cx - hw * 0.62, y - th * 0.42, first[0], first[1]);
      g.stroke();
      g.strokeStyle = pen(0.72);
      g.lineWidth = 1.05;
      g.beginPath();
      g.moveTo(ax, ay);
      g.quadraticCurveTo(cx + hw * 0.62, y - th * 0.42, last[0], last[1]);
      g.stroke();
      if (i === n - 1) {
        g.strokeStyle = pen(0.8);
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(ax, ay + 2);
        g.lineTo(ax + (rnd() - 0.5) * 2, ay - H * 0.05);
        g.stroke();
      }
    }
    footGrass(g, rnd, w * 0.12);
    grain(g, -L, -T, L + R, T + B, rnd);
  };
  return lazySprite(L + R, T + B, L, T, draw, {
    fit,
    vis: [-w / 2 - 4, -H - 4, w / 2 + 4, 4],
  });
}

// The boxes of the clumped trees these replaced (a canopy of radius R on a
// short trunk; a pine of five tiers): the furniture and the scene decided
// where a tree may stand by them, and still do (`Sprite.fit`).
const leafBox = (R: number): SpriteBox => ({
  w: R * 3.2,
  h: R * 3.6,
  ax: R * 1.6,
  ay: R * 3.35,
});
const pineBox = (R: number): SpriteBox => ({
  w: R * 2.4,
  h: R * 4.2,
  ax: R * 1.2,
  ay: R * 4.0,
});

const LEAFY = {
  n: 9,
  inner: 3,
  size: 0.21,
  lobe: 10,
  gap: 0.92,
} as const;
const BIRCH = {
  ...LEAFY,
  inner: 2,
  size: 0.19,
  lobe: 8,
  core: 0.86,
  taper: 0.45,
  into: 0.62,
  bark: "birch",
} as const;

/** The island's trees: 0..7 broadleaves, 8..10 conifers; and two in autumn colour. */
export function makeTrees(): {
  readonly trees: readonly Sprite[];
  readonly autumn: readonly Sprite[];
} {
  const trees = [
    broadleaf(
      "ash",
      {
        ...LEAFY,
        h: 116,
        cw: 78,
        ch: 82,
        trunkH: 30,
        tw: 7.5,
        pal: "beech",
        bark: "beech",
        n: 7,
        inner: 2,
        size: 0.23,
        lean: 3,
      },
      leafBox(31),
    ),
    broadleaf(
      "sapling",
      {
        ...LEAFY,
        h: 80,
        cw: 50,
        ch: 52,
        trunkH: 24,
        tw: 4.6,
        pal: "birch",
        bark: "oak",
        n: 5,
        inner: 1,
        size: 0.27,
        lobe: 8,
        twigs: 1,
        lean: -2,
      },
      leafBox(29),
    ),
    broadleaf(
      "birch",
      {
        ...BIRCH,
        h: 150,
        cw: 74,
        ch: 98,
        trunkH: 48,
        tw: 7,
        pal: "birch",
        n: 8,
        lean: 5,
      },
      leafBox(35),
    ),
    broadleaf(
      "beech",
      {
        ...LEAFY,
        h: 152,
        cw: 98,
        ch: 114,
        trunkH: 34,
        tw: 10,
        pal: "beech",
        bark: "beech",
        lean: -3,
      },
      leafBox(33),
    ),
    broadleaf(
      "oak",
      {
        ...LEAFY,
        h: 142,
        cw: 128,
        ch: 104,
        trunkH: 34,
        tw: 13,
        pal: "oak",
        bark: "oak",
        lobe: 11,
        lean: 3,
      },
      leafBox(39),
    ),
    broadleaf(
      "birch2",
      {
        ...BIRCH,
        h: 168,
        cw: 86,
        ch: 110,
        trunkH: 54,
        tw: 8.5,
        pal: "birch",
        lean: -6,
      },
      leafBox(37),
    ),
    broadleaf(
      "oak-old",
      {
        ...LEAFY,
        h: 170,
        cw: 156,
        ch: 126,
        trunkH: 40,
        tw: 17,
        pal: "oak",
        bark: "oak",
        n: 10,
        inner: 4,
        lobe: 12,
        lean: -4,
      },
      leafBox(43),
    ),
    broadleaf(
      "beech-old",
      {
        ...LEAFY,
        h: 180,
        cw: 114,
        ch: 138,
        trunkH: 38,
        tw: 12.5,
        pal: "beech",
        bark: "beech",
        n: 10,
        inner: 4,
        lean: 4,
      },
      leafBox(41),
    ),
    spruce("spruce-young", { h: 122, w: 66, tiers: 6 }, pineBox(26)),
    spruce("spruce", { h: 184, w: 92, tiers: 8 }, pineBox(30)),
    broadleaf(
      "pine",
      {
        ...LEAFY,
        h: 176,
        cw: 100,
        ch: 58,
        trunkH: 112,
        tw: 9,
        pal: "pine",
        bark: "pine",
        n: 7,
        inner: 2,
        size: 0.25,
        lobe: 9,
        gap: 0.6,
        flat: 0.72,
        stretch: 1.5,
        taper: 0.62,
        lean: 7,
        into: 0.55,
        shadow: 0.9,
      },
      pineBox(34),
    ),
  ];
  const autumn = [
    broadleaf(
      "beech-russet",
      {
        ...LEAFY,
        h: 150,
        cw: 100,
        ch: 112,
        trunkH: 34,
        tw: 10,
        pal: "russet",
        bark: "beech",
        lean: 3,
      },
      leafBox(32),
    ),
    broadleaf(
      "birch-gold",
      {
        ...BIRCH,
        h: 158,
        cw: 80,
        ch: 104,
        trunkH: 50,
        tw: 7.5,
        pal: "gold",
        n: 8,
        lean: -4,
      },
      leafBox(36),
    ),
  ];
  return { trees, autumn };
}

/** Four bushes: a few leaf masses over their twigs, two of them in flower or berry. */
export function makeBushes(): Sprite[] {
  return (["oak", "beech", "spruce", "birch"] as const).map((p, i) => {
    const s = i + 1;
    const pal = LEAF[p];
    return lazySprite(70, 50, 35, 42, (g) => {
      const rnd = seeded(7001 + s * 131);
      const sh = new Path2D();
      sh.addPath(leafMass(8, 1, 20, 6, rnd, 8).P);
      sh.addPath(leafMass(18, 2, 12, 4.5, rnd, 8).P);
      g.fillStyle = "rgba(34,40,24,.27)";
      g.fill(sh);
      g.strokeStyle = "#4a3b2a";
      g.lineWidth = 1.5;
      g.lineCap = "round";
      for (const [x0, y0, x1, y1] of [
        [-4, -2, -8, -12],
        [3, -2, 7, -13],
        [0, -2, 1, -18],
      ] as const) {
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
      paintMass(g, leafMass(0, -11, 16, 9, rnd, 9), pal, rnd, -0.6, {
        back: true,
      });
      for (const [x, y, a, b] of [
        [1, -19, 10, 7.5],
        [-10, -12, 9.5, 7.5],
        [10, -12, 10, 7.5],
        [-1, -7, 11, 6.5],
      ] as const) {
        const M = leafMass(
          x + (rnd() - 0.5) * 3,
          y + (rnd() - 0.5) * 2,
          a * (0.9 + rnd() * 0.25),
          b * (0.9 + rnd() * 0.25),
          rnd,
          8,
        );
        g.save();
        g.globalCompositeOperation = "source-atop";
        g.translate(1.5, 2.5);
        g.fillStyle = tone(pal[0], 0.5);
        g.fill(M.P);
        g.restore();
        paintMass(g, M, pal, rnd, (-x / 16) * 0.5 - ((y + 12) / 10) * 0.6, {
          dab: 10,
        });
      }
      if (s % 2 === 0)
        for (let k = 0; k < 9; k++) {
          g.fillStyle =
            s === 2 ? "rgba(226,218,196,.95)" : "rgba(170,74,60,.95)";
          g.beginPath();
          g.arc(-13 + rnd() * 26, -22 + rnd() * 15, 1.1, 0, 7);
          g.fill();
        }
      footGrass(g, rnd, 9);
      grain(g, -35, -42, 70, 50, rnd);
    });
  });
}
