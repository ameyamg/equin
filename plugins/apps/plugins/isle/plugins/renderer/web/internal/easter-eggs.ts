// The island's easter eggs — things nobody announces, found by being there at
// the right time: the werewolf that prowls deep in a wood at night, far from
// every house (howling at the moon, bolting when the hero comes near, gone into
// the dark and back later; villagers keep clear of its wood and flee when they see it), and the bats that circle the campfire at dusk. Pure drawing and motion; the engine
// says when (time of day), where (the layout) and puts them in its passes.

import type { Pt } from "@plugins/apps/plugins/isle/plugins/world/core";
import type { Ctx, Rnd } from "./kit";

// ---------------------------------------------------------------- werewolf

/** How far (px) every tree of the werewolf's wood stands from the nearest house or square. */
const WOOD_CLEAR = 380;
/** How near (px) a tree must stand to another for both to be the same wood. */
const WOOD_LINK = 140;
/** The fewest trees a wood has; fewer, and the werewolf stays away tonight. */
const WOOD_MIN = 6;
/** The most trees its prowl threads through. */
const WOOD_PATH_MAX = 40;

/**
 * The werewolf's wood: the biggest stand of trees ({@link WOOD_LINK} apart at
 * most) every tree of which is at least {@link WOOD_CLEAR} from every house
 * and square — its prowl, a chain through those trees (each the nearest one
 * not yet taken, from the tree farthest from any house), stepping just behind
 * each trunk so the crowns hide it. Null when the island has no such wood.
 */
export function wolfWood(
  trees: readonly Pt[],
  houses: readonly Pt[],
): { readonly key: string; readonly path: readonly Pt[] } | null {
  const clear = (x: number, y: number) => {
    let d = Infinity;
    for (const [hx, hy] of houses) d = Math.min(d, Math.hypot(hx - x, hy - y));
    return d;
  };
  const far = trees
    .map(([x, y]) => ({ x, y, c: clear(x, y) }))
    .filter((t) => t.c >= WOOD_CLEAR);
  // stands of trees: connected within WOOD_LINK, found through a grid of WOOD_LINK cells
  const cell = (v: number) => Math.floor(v / WOOD_LINK);
  const grid = new Map<string, number[]>();
  far.forEach((t, i) => {
    const k = `${cell(t.x)},${cell(t.y)}`;
    const l = grid.get(k);
    if (l) l.push(i);
    else grid.set(k, [i]);
  });
  const seen = new Uint8Array(far.length);
  let best: number[] = [];
  for (let s = 0; s < far.length; s++) {
    if (seen[s]) continue;
    seen[s] = 1;
    const stand = [s];
    for (let q = 0; q < stand.length; q++) {
      const t = far[stand[q]!]!;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const j of grid.get(`${cell(t.x) + dx},${cell(t.y) + dy}`) ??
            []) {
            if (seen[j]) continue;
            const o = far[j]!;
            if (Math.hypot(o.x - t.x, o.y - t.y) > WOOD_LINK) continue;
            seen[j] = 1;
            stand.push(j);
          }
    }
    if (stand.length > best.length) best = stand;
  }
  if (best.length < WOOD_MIN) return null;
  const left = best.map((i) => far[i]!);
  let at = left.reduce((a, b) => (b.c > a.c ? b : a));
  const chain = [at];
  left.splice(left.indexOf(at), 1);
  while (left.length && chain.length < WOOD_PATH_MAX) {
    let ni = -1;
    let nd = Infinity;
    left.forEach((o, i) => {
      const d = Math.hypot(o.x - at.x, o.y - at.y);
      if (d < nd) {
        nd = d;
        ni = i;
      }
    });
    // the nearest tree left is across a clearing: the prowl ends here
    if (nd > WOOD_LINK * 1.5) break;
    at = left[ni]!;
    chain.push(at);
    left.splice(ni, 1);
  }
  if (chain.length < 3) return null;
  return {
    key: `${chain[0]!.x},${chain[0]!.y}`,
    path: chain.map((t) => [t.x, t.y - 8] as const),
  };
}

/** How near (px, y squashed ×1.4) the hero may come before the werewolf bolts. */
const FLEE_NEAR = 170;
/** How far it runs before it melts into the dark. */
const FLEE_GONE = 520;
const PROWL_SPEED = 34;
const RUN_SPEED = 200;
const HOWL_S = 3.4;
const FADE_S = 0.6;

type WolfMode = "prowl" | "howl" | "flee" | "gone";

/** A line it says, shown from `t0` until `until` (engine clock, s). */
export interface WolfCry {
  readonly line: string;
  readonly t0: number;
  readonly until: number;
}

export class Werewolf {
  x = 0;
  y = 0;
  /** 1 faces right, -1 left. */
  face: 1 | -1 = 1;
  phase = 0;
  cry: WolfCry | null = null;
  private mode: WolfMode = "gone";
  private route: readonly Pt[] | null = null;
  private routeKey: string | null = null;
  private k = 0;
  private dir: 1 | -1 = 1;
  /** Seconds left in the current howl / absence; seconds until the next howl while prowling. */
  private timer = 0;
  private nextHowl = 6;
  /** 0..1: how raised the head is (a howl). */
  private raise = 0;
  /** 0..1: how much of it shows (fades in on arrival, out when gone). */
  private shown = 0;

  constructor(private readonly rnd: Rnd) {}

  /** Takes to its wood ({@link wolfWood}), or stays away while the island has none. */
  follow(wood: ReturnType<typeof wolfWood>): void {
    if (wood && this.route && wood.key === this.routeKey) return;
    this.route = wood?.path ?? null;
    this.routeKey = wood?.key ?? null;
    this.mode = "gone";
    this.timer = 2;
    this.shown = 0;
  }

  /** Its wood's prowl (world px), or null while it has none. */
  get wood(): readonly Pt[] | null {
    return this.route;
  }

  /** A villager it was seen by screamed: it growls back (unless it is already crying out). */
  startle(t: number): void {
    if (this.cry && t < this.cry.until) return;
    this.say("Grrr…", t, 1.4);
  }

  /** Nightfall: it is somewhere out there, about to show. */
  nightfall(): void {
    this.mode = "gone";
    this.timer = 2 + this.rnd() * 3;
    this.shown = 0;
    this.cry = null;
  }

  get present(): boolean {
    return this.route !== null && this.shown > 0.01;
  }

  /** How much of it shows (0..1). */
  get alpha(): number {
    return this.shown;
  }

  step(dt: number, t: number, hero: { x: number; y: number }): void {
    const route = this.route;
    if (!route) return;
    const rnd = this.rnd;
    const heroD = Math.hypot(hero.x - this.x, (hero.y - this.y) * 1.4);
    this.raise +=
      ((this.mode === "howl" ? 1 : 0) - this.raise) * Math.min(1, dt * 6);
    if (this.mode === "gone") {
      this.shown = Math.max(0, this.shown - dt / FADE_S);
      this.timer -= dt;
      if (this.timer > 0) return;
      // back where the hero is not: the route's point farthest from them
      let k = 0;
      let far = -1;
      route.forEach(([x, y], i) => {
        const d = Math.hypot(x - hero.x, y - hero.y);
        if (d > far) {
          far = d;
          k = i;
        }
      });
      if (far < FLEE_GONE * 0.6) {
        this.timer = 3;
        return;
      }
      this.k = k;
      this.x = route[k]![0];
      this.y = route[k]![1];
      this.dir = k > route.length / 2 ? -1 : 1;
      this.mode = "prowl";
      this.nextHowl = 2 + rnd() * 4;
      return;
    }
    this.shown = Math.min(1, this.shown + dt / FADE_S);
    if (this.mode !== "flee" && heroD < FLEE_NEAR) {
      this.mode = "flee";
      // away from the hero along the road
      const ahead = route[Math.min(route.length - 1, this.k + 3)]!;
      const behind = route[Math.max(0, this.k - 3)]!;
      const dA = Math.hypot(ahead[0] - hero.x, ahead[1] - hero.y);
      const dB = Math.hypot(behind[0] - hero.x, behind[1] - hero.y);
      this.dir = dA >= dB ? 1 : -1;
      this.say(rnd() < 0.5 ? "Grrr…!" : "!!", t, 1.2);
    }
    if (this.mode === "howl") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.mode = "prowl";
        this.nextHowl = 12 + rnd() * 14;
      }
      return;
    }
    if (this.mode === "flee" && (heroD > FLEE_GONE || this.atEnd())) {
      this.mode = "gone";
      this.timer = 9 + rnd() * 8;
      return;
    }
    if (this.mode === "prowl") {
      this.nextHowl -= dt;
      if (this.nextHowl <= 0) {
        this.mode = "howl";
        this.timer = HOWL_S;
        this.say("Awoooooo!", t, HOWL_S - 0.4);
        return;
      }
    }
    const sp = this.mode === "flee" ? RUN_SPEED : PROWL_SPEED;
    let left = sp * dt;
    while (left > 0) {
      const nk = this.k + this.dir;
      if (nk < 0 || nk >= route.length) {
        if (this.mode === "flee") break;
        this.dir = this.dir === 1 ? -1 : 1;
        break;
      }
      const [gx, gy] = route[nk]!;
      const ex = gx - this.x;
      const ey = gy - this.y;
      const L = Math.hypot(ex, ey);
      if (Math.abs(ex) > 0.5) this.face = ex > 0 ? 1 : -1;
      if (L <= left) {
        this.x = gx;
        this.y = gy;
        this.k = nk;
        left -= L;
        this.phase += L;
      } else {
        this.x += (ex / L) * left;
        this.y += (ey / L) * left;
        this.phase += left;
        left = 0;
      }
    }
  }

  private atEnd(): boolean {
    const nk = this.k + this.dir;
    return !this.route || nk < 0 || nk >= this.route.length;
  }

  private say(line: string, t: number, s: number): void {
    this.cry = { line, t0: t, until: t + s };
  }

  private get running(): boolean {
    return this.mode === "flee";
  }

  /** Draws it at its feet (world px), in its pose. */
  draw(g: Ctx, t: number): void {
    g.save();
    g.globalAlpha *= this.shown;
    g.translate(this.x, this.y);
    paintWerewolf(g, {
      face: this.face,
      phase: this.phase,
      run: this.running,
      raise: this.raise,
      t,
    });
    g.restore();
  }

  /** Where its eyes are (world px), for their glow in the dark. */
  eye(): Pt {
    const [ex, ey] = eyeAt(this.raise);
    return [this.x + ex * this.face, this.y + ey];
  }
}

interface WolfPose {
  readonly face: 1 | -1;
  readonly phase: number;
  readonly run: boolean;
  readonly raise: number;
  readonly t: number;
}

const FUR = "#6e5d55";
const FUR_LIGHT = "#8f7c6e";
const FUR_DARK = "#4a3d37";
const PANTS = "#5b4c82";
const OUTLINE = "#1f1612";

/** The head's centre (local, facing right) for a raise of 0..1. */
function headAt(raise: number): Pt {
  return [13 - 5 * raise, -45 - 9 * raise];
}

function eyeAt(raise: number): Pt {
  const [hx, hy] = headAt(raise);
  const a = -0.95 * raise;
  const [lx, ly] = [3.5, -2.5];
  return [
    hx + lx * Math.cos(a) - ly * Math.sin(a),
    hy + lx * Math.sin(a) + ly * Math.cos(a),
  ];
}

/** A thick inked stroke along points (outline under, fur over). */
function limb(g: Ctx, pts: readonly Pt[], w: number, col: string): void {
  g.beginPath();
  g.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = OUTLINE;
  g.lineWidth = w + 2.6;
  g.stroke();
  g.strokeStyle = col;
  g.lineWidth = w;
  g.stroke();
}

function leg(g: Ctx, hx: number, swing: number, near: boolean): void {
  g.save();
  g.translate(hx, -24);
  g.rotate(swing);
  // thigh in ragged trousers, then the digitigrade shin and the paw
  limb(
    g,
    [
      [0, 0],
      [5, 9],
    ],
    8,
    near ? PANTS : "#4a3d6c",
  );
  limb(
    g,
    [
      [5, 9],
      [-1, 17],
      [6, 24],
    ],
    5.5,
    near ? FUR : FUR_DARK,
  );
  g.fillStyle = "#e9e1cc";
  for (const dx of [7.5, 9.5]) {
    g.beginPath();
    g.moveTo(dx, 23);
    g.lineTo(dx + 2.2, 24.5);
    g.lineTo(dx, 25);
    g.fill();
  }
  g.restore();
}

function arm(g: Ctx, swing: number, near: boolean, run: boolean): void {
  g.save();
  g.translate(9, -40);
  g.rotate(swing + (run ? -0.6 : 0));
  limb(
    g,
    [
      [0, 0],
      [5, 10],
      [6, 21],
    ],
    5,
    near ? FUR_LIGHT : FUR_DARK,
  );
  // claws
  g.strokeStyle = "#efe7d2";
  g.lineWidth = 1.2;
  g.beginPath();
  for (const dx of [-1.5, 1, 3.5]) {
    g.moveTo(6 + dx, 22);
    g.lineTo(7 + dx * 1.2, 26);
  }
  g.stroke();
  g.restore();
}

/** The werewolf at its feet (0, 0), facing `face`, in a hunched side view. */
function paintWerewolf(g: Ctx, p: WolfPose): void {
  const walkF = p.run ? 0.09 : 0.11;
  const amp = p.run ? 0.75 : 0.42;
  const s = Math.sin(p.phase * walkF) * amp * (1 - p.raise);
  const bob = Math.abs(Math.cos(p.phase * walkF)) * (p.run ? 3 : 1.4);
  // shadow, before the flip and the bob
  g.fillStyle = "rgba(20,24,16,.26)";
  g.beginPath();
  g.ellipse(0, 1, 17, 5, 0, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.scale(p.face, 1);
  g.translate(0, -bob);
  const lean = 0.45 * (1 - p.raise) + (p.run ? 0.25 : 0) - 0.15 * p.raise;

  arm(g, -s, false, p.run);
  leg(g, -3, -s, false);
  // tail, swishing
  const sw = Math.sin(p.t * 3) * 3;
  // a bushy brush: fat at the rump, tapering to a pale tip
  const tx = -25;
  const ty = -17 + sw * 1.4;
  const tail = new Path2D();
  tail.moveTo(-6, -35);
  tail.quadraticCurveTo(-22, -41 + sw, tx - 1, ty - 1);
  tail.quadraticCurveTo(tx, ty + 2, tx + 3, ty + 1);
  tail.quadraticCurveTo(-13, -17 + sw, -6, -24);
  tail.closePath();
  g.fillStyle = FUR;
  g.fill(tail);
  g.save();
  g.clip(tail);
  g.beginPath();
  g.arc(tx + 1, ty - 2, 6, 0, Math.PI * 2);
  g.fillStyle = FUR_LIGHT;
  g.fill();
  g.restore();
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1.6;
  g.lineJoin = "round";
  g.stroke(tail);
  // torso
  g.save();
  g.translate(2, -33);
  g.rotate(lean);
  g.beginPath();
  g.ellipse(0, 0, 11.5, 15, 0, 0, Math.PI * 2);
  g.fillStyle = FUR;
  g.fill();
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1.6;
  g.stroke();
  g.beginPath();
  g.ellipse(4, 3, 5.5, 9, 0, 0, Math.PI * 2);
  g.fillStyle = FUR_LIGHT;
  g.fill();
  // a ruff of fur down the back
  g.fillStyle = FUR_DARK;
  g.beginPath();
  g.moveTo(-8, -11);
  for (let i = 0; i < 5; i++) {
    g.lineTo(-13 - (i % 2) * 3, -8 + i * 4);
  }
  g.lineTo(-9, 10);
  g.closePath();
  g.fill();
  g.restore();
  leg(g, 3, s, true);

  // head: skull, snout, ears; raised toward the moon in a howl
  const [hx, hy] = headAt(p.raise);
  g.save();
  g.translate(hx, hy);
  g.rotate(-0.95 * p.raise);
  g.fillStyle = FUR;
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1.6;
  // ears
  for (const [ex, tilt] of [
    [-5, -0.2],
    [0, 0.15],
  ] as const) {
    g.beginPath();
    g.moveTo(ex - 3, -5);
    g.lineTo(ex - 2 + tilt * 10, -15);
    g.lineTo(ex + 3, -6);
    g.closePath();
    g.fill();
    g.stroke();
  }
  // snout (the jaw drops in a howl)
  const jaw = p.raise * 3.5;
  g.beginPath();
  g.moveTo(3, -4);
  g.lineTo(14, -2);
  g.quadraticCurveTo(16, 0, 14, 1.5);
  g.lineTo(4, 3);
  g.closePath();
  g.fill();
  g.stroke();
  if (jaw > 0.3) {
    g.beginPath();
    g.moveTo(4, 3);
    g.lineTo(13, 1.5 + jaw);
    g.lineTo(4, 5 + jaw * 0.4);
    g.closePath();
    g.fillStyle = "#3a1717";
    g.fill();
    g.stroke();
    g.fillStyle = FUR;
  }
  g.beginPath();
  g.arc(0, -1, 7.5, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  // nose
  g.fillStyle = OUTLINE;
  g.beginPath();
  g.arc(14.5, -1.5, 1.6, 0, Math.PI * 2);
  g.fill();
  // eye
  g.fillStyle = "#ffd84a";
  g.beginPath();
  g.ellipse(3.5, -2.5, 1.9, 1.3, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  arm(g, s, true, p.run);
  g.restore();
}

/** Its box round its feet (local px), like a person's. */
export const WOLF_BOX = [-32, -66, 32, 10] as const;

// ---------------------------------------------------------------- dusk bats

/** Bats circling a point at dusk (world px), each on its own loop. */
export function drawBats(g: Ctx, cx: number, cy: number, t: number): void {
  g.save();
  g.fillStyle = "#231c22";
  for (let i = 0; i < 6; i++) {
    const a = t * (0.7 + (i % 3) * 0.18) + i * 1.9;
    const r = 70 + (i % 4) * 28;
    const x = cx + Math.cos(a) * r;
    const y = cy - 110 - (i % 3) * 22 + Math.sin(a * 1.7) * 26;
    const f = Math.sin(t * 18 + i * 2.3);
    const w = 7;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x - w * 0.5, y - 4 * f - 2, x - w, y - 5 * f);
    g.quadraticCurveTo(x - w * 0.6, y + 1, x, y + 2);
    g.quadraticCurveTo(x + w * 0.6, y + 1, x + w, y - 5 * f);
    g.quadraticCurveTo(x + w * 0.5, y - 4 * f - 2, x, y);
    g.fill();
  }
  g.restore();
}
