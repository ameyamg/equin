// The campfire's secrets, beside easter-eggs.ts and surprises.ts: the fire
// burning low in the small hours and flaring up at dawn (by the real clock),
// sparks when it is clicked (and fireworks when it is clicked five times
// running), the hero toasting a marshmallow when left standing by it at night,
// and the villagers gathering round it at night to tell stories. Pure drawing,
// timing and lines; the engine says where the fire is, who stands where, and
// walks them.

import type { Pt } from "@plugins/apps/plugins/isle/plugins/world/core";
import { put, type Ctx, type Rnd, type Sprite } from "./kit";

// ---------------------------------------------------------------- the clock

/** Local hours of `d`, fractional (14.5 = 2:30 pm). */
export const clockHours = (d: Date): number =>
  d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;

const LOW = 0.38;
const FLARE = 1.5;
const ss = (a: number, b: number, x: number) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/**
 * How high the fire burns at local hour `h`: 1 most of the day; dying down
 * after midnight to embers from 1:00 until dawn (5:30), then flaring up as
 * someone throws on wood, settled again by 7:00.
 */
export function fireStrength(h: number): number {
  if (h < 0.5 || h >= 7) return 1;
  if (h < 1.5) return 1 - (1 - LOW) * ss(0.5, 1.5, h);
  if (h < 5.5) return LOW;
  if (h < 5.75) return LOW + (FLARE - LOW) * ss(5.5, 5.75, h);
  if (h < 6.25) return FLARE;
  return FLARE - (FLARE - 1) * ss(6.25, 7, h);
}

/** Whether the fire is flaring (spitting sparks by itself). */
export const flaring = (strength: number): boolean => strength > 1.2;

// ---------------------------------------------------------------- the flames

/**
 * The fire's flames and smoke at (fx, fy) — the fire ring's anchor —, as high
 * as `strength` says: embers glowing in the ash (brightest when the fire is
 * low), three tongues of flame rising from among the logs and a pale core,
 * each a closed teardrop washed from a bright foot to a fading tip, a few
 * sparks of its own, thin smoke. `front` — the ring's near stones and logs
 * alone (`SpriteSet.campFront`) — is laid back over the flames' feet, so the
 * fire rises from behind them and never shows a flat base. About fifteen
 * small fills and one sprite a frame.
 */
export function drawFlames(
  g: Ctx,
  fx: number,
  fy: number,
  t: number,
  strength: number,
  front: Sprite,
): void {
  const high = Math.min(1, strength);
  const sway = Math.min(1.3, strength);
  const wide = Math.min(1.25, 0.6 + 0.4 * strength);
  const base = fy + 1;
  const foot = base + 3;
  const tongue = (
    dx: number,
    w0: number,
    h0: number,
    ph: number,
    [low, mid, tip]: readonly [string, string, string],
    line?: string,
  ) => {
    const s =
      (Math.sin(t * 7.3 + ph) * 2.4 + Math.sin(t * 13.1 + ph * 2.3) * 1.2) *
      sway;
    const hh = h0 * strength * (0.9 + 0.12 * Math.sin(t * 9.7 + ph * 1.7));
    const w = w0 * wide;
    const x = fx + dx * wide;
    const gr = g.createLinearGradient(0, foot, 0, base - hh);
    gr.addColorStop(0, low);
    gr.addColorStop(0.55, mid);
    gr.addColorStop(1, tip);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x, foot);
    g.bezierCurveTo(
      x - w * 0.9,
      foot,
      x - w * 1.25,
      base - hh * 0.3,
      x - w * 0.5 + s * 0.3,
      base - hh * 0.6,
    );
    g.quadraticCurveTo(
      x - w * 0.1 + s * 0.7,
      base - hh * 0.82,
      x + s,
      base - hh,
    );
    g.quadraticCurveTo(
      x + w * 0.35 + s * 0.5,
      base - hh * 0.75,
      x + w * 0.7 + s * 0.2,
      base - hh * 0.5,
    );
    g.bezierCurveTo(x + w * 1.3, base - hh * 0.25, x + w * 0.9, foot, x, foot);
    g.fill();
    if (line) {
      g.strokeStyle = line;
      g.lineWidth = 0.9;
      g.stroke();
    }
  };
  // smoke, from above the flames
  const top = base - 28 * strength;
  for (let i = 0; i < 4; i++) {
    const k = (t * 0.28 + i / 4) % 1;
    g.fillStyle = `rgba(196,194,186,${0.2 * (1 - k) * high})`;
    g.beginPath();
    g.arc(
      fx + Math.sin(k * 5 + i) * 7 + k * 10,
      top - 8 - k * 64,
      4 + k * 11,
      0,
      7,
    );
    g.fill();
  }
  // embers, glowing under the flames, brightest when the fire is low
  const ember = 0.5 + 0.5 * Math.sin(t * 2.3);
  const fl = 0.85 + 0.15 * Math.sin(t * 11.3);
  g.fillStyle = `rgba(255,150,50,${0.2 * fl})`;
  g.beginPath();
  g.ellipse(fx, base - 1, 19, 10.5, 0, 0, 7);
  g.fill();
  g.fillStyle = `rgba(255,${(110 + 80 * ember * high) | 0},${(40 + 56 * high) | 0},${0.3 * fl + 0.45 * (1 - high)})`;
  g.beginPath();
  g.ellipse(fx, base - 2, 11, 6, 0, 0, 7);
  g.fill();
  tongue(-3.5, 8, 28, 0, FLAME.outer, "rgba(120,48,24,.45)");
  tongue(4.5, 7, 22, 2.1, FLAME.side, "rgba(120,48,24,.4)");
  tongue(0.5, 6, 21, 4.2, FLAME.inner);
  tongue(0, 3.6, 13, 1.3, FLAME.core);
  put(g, front, fx, fy);
  // the fire's own few sparks (a click's, and the dawn flare's, are `Sparks`)
  for (let i = 0; i < 3; i++) {
    const k = (t * 0.7 + i / 3) % 1;
    g.fillStyle = `rgba(255,190,90,${0.9 * (1 - k) * high})`;
    g.beginPath();
    g.arc(
      fx + Math.sin(k * 6 + i * 2.1) * 9,
      base - (18 + k * 42) * strength,
      0.8,
      0,
      7,
    );
    g.fill();
  }
}

/** Each tongue's wash: its foot, its body, its fading tip. */
const FLAME = {
  outer: ["rgba(226,120,44,.92)", "rgba(190,74,34,.9)", "rgba(190,74,34,.55)"],
  side: ["rgba(232,128,46,.9)", "rgba(200,86,36,.88)", "rgba(200,86,36,.55)"],
  inner: [
    "rgba(250,196,90,.95)",
    "rgba(234,142,50,.92)",
    "rgba(234,142,50,.55)",
  ],
  core: [
    "rgba(255,244,196,.96)",
    "rgba(252,216,128,.95)",
    "rgba(252,216,128,.55)",
  ],
} as const;

// ---------------------------------------------------------------- sparks

interface Spark {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly t0: number;
  readonly life: number;
}

/** Sparks flying up off the fire (world px, the engine clock). */
export class Sparks {
  private sparks: Spark[] = [];

  constructor(private readonly rnd: Rnd) {}

  /** `n` sparks from (x, y), `power` 1 a click's burst. */
  burst(x: number, y: number, t: number, n: number, power = 1): void {
    const rnd = this.rnd;
    for (let i = 0; i < n; i++) {
      this.sparks.push({
        x: x + (rnd() - 0.5) * 14,
        y: y - rnd() * 10,
        vx: (rnd() - 0.5) * 70 * power,
        vy: -(70 + rnd() * 110) * power,
        t0: t + rnd() * 0.15,
        life: 0.8 + rnd() * 0.9,
      });
    }
  }

  draw(g: Ctx, t: number): void {
    this.sparks = this.sparks.filter((s) => t - s.t0 < s.life);
    for (const s of this.sparks) {
      const k = t - s.t0;
      if (k < 0) continue;
      const a = 1 - k / s.life;
      // drifting up and slowing, swaying in the heat
      const x = s.x + s.vx * k + Math.sin(k * 9 + s.vx) * 3;
      const y = s.y + s.vy * k + 40 * k * k;
      g.fillStyle = `rgba(255,${(200 - 90 * (1 - a)) | 0},90,${a})`;
      g.beginPath();
      g.arc(x, y, 1.1 + 1.2 * a, 0, 7);
      g.fill();
    }
  }
}

// ---------------------------------------------------------------- clicking the fire

/** How long (s) between two clicks still counts as clicking it running. */
const CLICK_GAP_S = 1.2;
/** Clicks running that set the fireworks off. */
export const FIRE_CLICKS_FOR_FIREWORKS = 5;

/** The fire being clicked: sparks each time, fireworks on the fifth click running. */
export class FireClicks {
  private n = 0;
  private lastAt = -Infinity;

  /** One click at `t`: true when it sets the fireworks off. */
  click(t: number): boolean {
    if (t - this.lastAt > CLICK_GAP_S) this.n = 0;
    this.lastAt = t;
    this.n++;
    if (this.n < FIRE_CLICKS_FOR_FIREWORKS) return false;
    this.n = 0;
    return true;
  }
}

// ---------------------------------------------------------------- the marshmallow

/** How near (px, y squashed ×1.4) the hero stands to toast, and how long idle first. */
export const TOAST_NEAR = 95;
const TOAST_WAIT_S = 2.5;
/** Seconds from raw to burnt. */
const TOAST_S = 14;
const EAT_AT = 0.7;
const BURN_S = 1.3;
const NEXT_S = 2.5;

type Toast =
  | { readonly kind: "waiting"; readonly since: number }
  | {
      readonly kind: "toasting";
      readonly t0: number;
      /** Eaten golden, or held too long and caught fire. */
      readonly fate: "eat" | "burn";
    }
  | { readonly kind: "burning"; readonly t0: number }
  | { readonly kind: "done"; readonly at: number };

/** A line the hero says, shown from `t0` until `until` (engine clock, s). */
export interface ToastLine {
  readonly line: string;
  /** It caught fire. */
  readonly burnt: boolean;
  readonly t0: number;
  readonly until: number;
}

const EAT_LINES = ["Mmm, perfect!", "Golden. Just right.", "One more…"];
const BURN_LINES = [
  "Oops — too close!",
  "Ah! It's on fire!",
  "…I like them crispy.",
];

/** The hero toasting marshmallows by the fire at night, while left standing there. */
export class Marshmallow {
  private state: Toast | null = null;

  constructor(private readonly rnd: Rnd) {}

  /** Whether the hero holds a stick (and should face the fire). */
  get holding(): boolean {
    return this.state?.kind === "toasting" || this.state?.kind === "burning";
  }

  /**
   * One frame: `ready` while the hero stands idle near the fire at night.
   * Returns a line for the hero to say, when one is due.
   */
  step(t: number, ready: boolean): ToastLine | null {
    if (!ready) {
      this.state = null;
      return null;
    }
    const s = this.state;
    if (!s) {
      this.state = { kind: "waiting", since: t };
      return null;
    }
    if (s.kind === "waiting" || s.kind === "done") {
      const due = s.kind === "waiting" ? s.since + TOAST_WAIT_S : s.at + NEXT_S;
      if (t >= due)
        this.state = {
          kind: "toasting",
          t0: t,
          fate: this.rnd() < 0.65 ? "eat" : "burn",
        };
      return null;
    }
    if (s.kind === "toasting") {
      const k = (t - s.t0) / TOAST_S;
      if (s.fate === "eat" && k >= EAT_AT) {
        this.state = { kind: "done", at: t };
        return this.say(EAT_LINES, t, false);
      }
      if (s.fate === "burn" && k >= 1) {
        this.state = { kind: "burning", t0: t };
        return this.say(BURN_LINES, t, true);
      }
      return null;
    }
    if (t - s.t0 >= BURN_S) this.state = { kind: "done", at: t };
    return null;
  }

  private say(lines: readonly string[], t: number, burnt: boolean): ToastLine {
    const line = lines[(this.rnd() * lines.length) | 0]!;
    return { line, t0: t, until: t + 2.2, burnt };
  }

  /** The stick from the hero's hand at (hx, hy) towards the fire's flames at (fx, fy). */
  draw(
    g: Ctx,
    hx: number,
    hy: number,
    fx: number,
    fy: number,
    t: number,
  ): void {
    const s = this.state;
    if (!s || (s.kind !== "toasting" && s.kind !== "burning")) return;
    const dx = fx - hx;
    const dy = fy - hy;
    const L = Math.hypot(dx, dy) || 1;
    const len = Math.min(L - 8, 40);
    const wob = Math.sin(t * 1.7) * 1.2;
    const tx = hx + (dx / L) * len;
    const ty = hy + (dy / L) * len + wob;
    g.save();
    g.strokeStyle = "#5a4027";
    g.lineWidth = 1.6;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(tx, ty);
    g.stroke();
    // white → golden → brown → black
    const k = s.kind === "toasting" ? Math.min(1, (t - s.t0) / TOAST_S) : 1;
    const stops: readonly (readonly [number, number, number])[] = [
      [250, 246, 238],
      [236, 190, 110],
      [150, 92, 46],
      [44, 34, 30],
    ];
    const f = k * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(f));
    const u = f - i;
    const [r, gg, b] = stops[i]!.map((c, j) =>
      Math.round(c + (stops[i + 1]![j]! - c) * u),
    ) as [number, number, number];
    g.fillStyle = `rgb(${r},${gg},${b})`;
    g.strokeStyle = "rgba(40,30,25,.8)";
    g.lineWidth = 0.8;
    g.beginPath();
    g.ellipse(tx, ty, 3.6, 3, 0, 0, 7);
    g.fill();
    g.stroke();
    if (s.kind === "burning") {
      const fl = Math.sin(t * 14) * 1.5;
      g.fillStyle = "rgba(255,170,60,.9)";
      g.beginPath();
      g.moveTo(tx - 4, ty - 1);
      g.quadraticCurveTo(tx + fl, ty - 14, tx + 4, ty - 1);
      g.fill();
    }
    g.restore();
  }
}

// ---------------------------------------------------------------- gathering round the fire

/**
 * Where the `i`-th of `n` places round the fire at (x, y) is: on an ellipse
 * round the stones (the ground is seen from above at a slant), spread evenly,
 * starting off the top so the nearest place is never straight in front.
 */
export function seatAround(x: number, y: number, i: number, n: number): Pt {
  const a = -Math.PI / 2 + ((i + 0.5) / n) * Math.PI * 2;
  return [x + Math.cos(a) * 62, y + Math.sin(a) * 44];
}

/** One line of a story: told by the teller, or a listener's reaction. */
type StoryLine = readonly ["teller" | "listener", string];

const STORIES: readonly (readonly StoryLine[])[] = [
  [
    ["teller", "Did I ever tell you about the well?"],
    ["listener", "Not the well again…"],
    ["teller", "They say there's a whole cave down there."],
    ["teller", "With a lake. And something sleeping in it."],
    ["listener", "Ooh."],
  ],
  [
    ["teller", "Once, a building moved in the night."],
    ["listener", "Buildings don't move!"],
    ["teller", "This one did. Picked up and set down elsewhere."],
    ["listener", "…by whom?"],
    ["teller", "By whoever walks this island, of course."],
  ],
  [
    ["teller", "Listen. Hear that howl?"],
    ["listener", "Just the wind."],
    ["teller", "The wind doesn't have teeth."],
    ["listener", "Brr."],
  ],
  [
    ["teller", "Out past the harbour, the sea has a long green back."],
    ["listener", "A serpent?"],
    ["teller", "Only shows itself to the patient."],
    ["listener", "I'm very patient."],
    ["teller", "You're very loud."],
  ],
  [
    ["teller", "On New Year's night, this fire throws stars."],
    ["listener", "Every year?"],
    ["teller", "Some say it'll do it any night…"],
    ["teller", "…if you poke it enough."],
  ],
  [
    ["teller", "Every new app gets a new house here."],
    ["listener", "Who builds them?"],
    ["teller", "Nobody's ever seen. They're just there one morning."],
    ["listener", "Spooky. And handy."],
  ],
  [
    ["teller", "Up the river there's a fish this big."],
    ["listener", "Last time it was this big."],
    ["teller", "It's been eating well."],
  ],
];

const WELCOME = [
  "Pull up a log, traveller!",
  "Sit, sit — you're just in time.",
  "Shh, there's a story going.",
  "Warm your hands, friend.",
];

/** Seconds between two lines of a story, and between two stories. */
const LINE_GAP_S = 0.9;
const STORY_GAP_S = 6;

/** Who says what next round the fire: an index into the gathered, and the line. */
export interface FireLine {
  readonly who: number;
  readonly line: string;
}

/**
 * The stories told round the fire: one teller at a time (turn about), a
 * listener chiming in; a welcome when the hero walks up. The engine says when
 * the last line finished showing and who is gathered.
 */
export class Storyteller {
  private story = 0;
  private line = 0;
  /** Whose turn it is to tell the next story. */
  private turn = 0;
  /** Who tells the story under way (pinned at its first line, so someone sitting down mid-story cannot take it over). */
  private teller = 0;
  private listener = 0;
  private nextAt = 0;
  private welcomed = false;

  constructor(private readonly rnd: Rnd) {
    this.story = (rnd() * STORIES.length) | 0;
  }

  /**
   * The next line due at `t`, given `n` gathered (2 or more tell stories), that
   * the last line shows until `busyUntil`, and whether the hero is near.
   */
  next(
    t: number,
    n: number,
    busyUntil: number,
    heroNear: boolean,
  ): FireLine | null {
    if (!heroNear) this.welcomed = false;
    if (n < 1 || t < busyUntil + LINE_GAP_S) return null;
    if (heroNear && !this.welcomed) {
      this.welcomed = true;
      const line = WELCOME[(this.rnd() * WELCOME.length) | 0]!;
      return { who: (this.turn + 1) % n, line };
    }
    if (n < 2 || t < this.nextAt) return null;
    const S = STORIES[this.story % STORIES.length]!;
    if (this.line === 0) {
      this.teller = this.turn % n;
      this.listener = this.teller;
    }
    // someone left mid-story: whoever sits in that place goes on with it
    const teller = this.teller % n;
    const [role, line] = S[this.line]!;
    const who = role === "teller" ? teller : this.listenerOf(teller, n);
    this.line++;
    if (this.line >= S.length) {
      this.line = 0;
      this.story++;
      this.turn = teller + 1;
      this.nextAt = t + STORY_GAP_S;
    }
    return { who, line };
  }

  /** A different listener each time someone chimes in, never the teller. */
  private listenerOf(teller: number, n: number): number {
    this.listener = (this.listener + 1) % n;
    if (this.listener === teller) this.listener = (this.listener + 1) % n;
    return this.listener;
  }
}
