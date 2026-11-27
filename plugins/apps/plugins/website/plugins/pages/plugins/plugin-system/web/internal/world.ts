import { clamp01, lerp, r1, smooth, type Vec3 } from "./math";

/**
 * The world the page draws: one island of bricks. Generated once, from a fixed
 * seed, so it is the same city on every visit; where a brick is at a given
 * moment is the scene's business (`scene.ts`), not this module's.
 *
 * Units: one stud. x runs to the lower right of the screen, y to the lower
 * left, z up. The camera looks down the (1,1,1) diagonal, so larger x + y is
 * nearer to you. The ground rolls in terraces and stops at a ragged shore
 * around RIM.
 *
 * The order of the random draws is part of the design (it decides every
 * brick's size and arrival): keep it when changing anything here.
 */
export const N = 72;
const G = N / 2;
export const CX = 36;
export const CY = 36;
export const RIM = 31;
/** The first app's lot. */
export const CHX = 50;
export const CHY = 42;
/** The first plugin: a 2×4 brick, on the ground in front of the first app. */
export const HX = CHX + 2;
export const HY = CHY + 6;
/** How far the swapped-out piece slides. */
export const SLIDE = 7;
/** The removed feature: the two thin floors from z = 9 to 10. */
export const REM_Z = 4 + 5;

/** Palette index: 0–4 foundation layers bottom→top, then these. */
export const TOWER = 5;
export const LIT = 6;
export const PICK = 7;

export type BlockRole =
  "" | "hero" | "early" | "swapOld" | "swapNew" | "found" | "tower" | "removed";

export interface Block {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Palette index. */
  c: number;
  /** The p at which it starts to land, and how long the landing takes. */
  t0: number;
  dur: number;
  /** How far above its place it starts. */
  drop: number;
  /** Carries studs on top (while they are shown). */
  studs: number;
  /** The tower it belongs to, or -1 for the foundation. */
  group: number;
  role: BlockRole;
  /** A hero half: 0 the lower (server), 1 the upper (browser). */
  k: number;
  /** Turned around (px, py) by rot. */
  rot: number;
  px: number;
  py: number;
  /** Its four corners once turned, as x,y pairs; null when it is not turned. */
  q: number[] | null;
  bridge: boolean;
  /** The sub-system it belongs to (foundation only). */
  sys: number;
  /** The plugin it stands for. */
  plugin: string;
  /** Its place in the draw order. */
  i: number;
  /** Too thin to inset (halo bars, masts). */
  flat: boolean;
  // ---- live state, written by the scene every frame ----
  on: boolean;
  dx: number;
  dz: number;
  da: number;
  cr: number;
  cg: number;
  cb: number;
  hov: boolean;
}

type TowerKind =
  "twist" | "lens" | "cantilever" | "stilts" | "plain" | "pyramid" | "first";

interface Lot {
  x: number;
  y: number;
  /** The lot's side. */
  s: number;
  kind: TowerKind;
  w: number;
  d: number;
  floors: number;
  name: string;
  key: string;
  twist: number;
  rings: number;
  needle: number;
  mega: boolean;
  base: number;
}

export interface Tower {
  id: number;
  /** Its lot's side. */
  S: number;
  name: string;
  key: string;
  cx: number;
  cy: number;
  /** Where its name pins: its top. */
  tip: Vec3;
  base: number;
  /** Its floor height. */
  FH: number;
}

export interface SubSystem {
  id: number;
  name: string;
  sub: string;
  x: number;
  y: number;
  plugins: readonly string[];
  n: number;
}

export interface Build {
  /** 1 for each brick the build ships, by draw index. */
  sel: Uint8Array;
  /** How late each brick lights: the further from the build's towers (and the higher up), the later. */
  delay: Float32Array;
}

export interface Stud {
  b: Block;
  ox: number;
  oy: number;
}

export interface World {
  blocks: Block[];
  towers: Tower[];
  systems: SubSystem[];
  builds: Build[];
  studs: Stud[];
  /** The Agent manager and the first app (Mail). */
  agent: Tower;
  first: Tower;
  /** Each tower's first brick in draw order. */
  firstOf: number[];
}

const must = <T>(v: T | undefined, what: string): T => {
  if (v === undefined) throw new Error(`[plugin-system] no ${what}`);
  return v;
};

export function buildWorld(): World {
  let seed = 20261113;
  const rnd = (): number => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // smooth value noise, 0…1
  function makeNoise() {
    const M = 64;
    const g = new Float32Array(M * M);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    const at = (a: number, b: number) =>
      g[(((a % M) + M) % M) + (((b % M) + M) % M) * M] ?? 0;
    return (x: number, y: number) => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const fx = smooth(x - xi);
      const fy = smooth(y - yi);
      return lerp(
        lerp(at(xi, yi), at(xi + 1, yi), fx),
        lerp(at(xi, yi + 1), at(xi + 1, yi + 1), fx),
        fy,
      );
    };
  }
  const nA = makeNoise();
  const nB = makeNoise();
  // a third field is drawn to keep the generator where the design left it
  makeNoise();
  const relief = (x: number, y: number) =>
    0.62 * nA(x / 17, y / 17) + 0.38 * nB(x / 7, y / 7);
  const shore = (x: number, y: number) =>
    RIM + 7 * (nA(x / 9 + 3, y / 9 + 7) - 0.5) + 3 * (nB(x / 4, y / 4) - 0.5);
  // the island is a little wider across the screen than it is deep
  const WIDE = 1.15;
  const fromCentre = (x: number, y: number) =>
    Math.hypot((x - CX - (y - CY)) / WIDE, x - CX + y - CY) / Math.SQRT2;
  const fromFirst = (x: number, y: number) =>
    Math.hypot(x - CHX - 2, y - CHY - 2);

  const blocks: Block[] = [];
  function add(
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    h: number,
    c: number,
    t0: number,
    dur: number,
    o: Partial<Block> = {},
  ): Block {
    const b: Block = {
      x,
      y,
      z,
      w,
      d,
      h,
      c,
      t0,
      dur,
      drop: 9,
      studs: 0,
      group: -1,
      role: "",
      k: 0,
      rot: 0,
      px: 0,
      py: 0,
      q: null,
      bridge: false,
      sys: 0,
      plugin: "",
      i: 0,
      flat: false,
      on: false,
      dx: x,
      dz: z,
      da: 0,
      cr: 0,
      cg: 0,
      cb: 0,
      hov: false,
      ...o,
    };
    if (b.rot) {
      const co = Math.cos(b.rot);
      const si = Math.sin(b.rot);
      const q: number[] = [];
      for (const [u, v] of [
        [x, y],
        [x + w, y],
        [x + w, y + d],
        [x, y + d],
      ] as const)
        q.push(
          b.px + co * (u - b.px) - si * (v - b.py),
          b.py + si * (u - b.px) + co * (v - b.py),
        );
      b.q = q;
    }
    blocks.push(b);
    return b;
  }

  // -- where the towers stand: the Agent manager in the middle, Mail as the first app on its own lot,
  //    the other apps around them, and a few slim pyramids. Nothing stands behind the Agent manager:
  //    the back towers are out on either side of it.
  const TS = 1.5;
  const lot = (o: Partial<Lot> & Pick<Lot, "x" | "y" | "s" | "kind">): Lot => ({
    w: 2,
    d: 2,
    floors: 0,
    name: "",
    key: "",
    twist: 0,
    rings: 0,
    needle: 0,
    mega: false,
    base: 0,
    ...o,
  });
  const lots: Lot[] = [
    lot({
      x: CX - 6,
      y: CY - 6,
      s: 10,
      kind: "twist",
      w: 4,
      d: 4,
      floors: 64,
      twist: 1.5,
      rings: 15,
      needle: 4.5,
      name: "Agent manager",
      key: "agent",
      mega: true,
    }),
    lot({ x: CHX, y: CHY, s: 4, kind: "first", floors: 22, name: "Mail" }),
  ];
  // x, y: studs from the centre
  const PLAN: readonly (readonly [
    key: string,
    name: string,
    tx: number,
    ty: number,
    w: number,
    d: number,
    floors: number,
    kind: TowerKind,
    extra?: Partial<Lot>,
  ])[] = [
    ["sonata", "Sonata", -15.6, 8.5, 3, 3, 50, "lens", { needle: 3 }],
    ["pages", "Pages", 2.8, -17, 3, 2, 46, "cantilever", { needle: 2.5 }],
    ["chord", "Chord", 11.3, -18.4, 2, 2, 36, "cantilever"],
    ["places", "Places", 21.9, -16.3, 2, 2, 26, "stilts"],
    ["home", "Home", 10.6, -6.4, 2, 2, 22, "twist", { twist: 4 }],
    ["events", "Events", -14.1, 18.4, 2, 2, 30, "twist", { twist: -2.6 }],
    ["studio", "Plugin studio", -4.9, 16.3, 2, 2, 26, "twist", { twist: 3.5 }],
    ["protos", "Prototypes", 2.8, 15.6, 3, 3, 30, "lens"],
    ["browser", "Browser", -2.1, 26.2, 2, 2, 28, "stilts"],
    ["settings", "Settings", -23.3, 14.8, 2, 2, 14, "plain"],
    ["debug", "Debug", -11.3, 26.9, 2, 2, 11, "plain"],
    ["deploy", "Deploy", 8.5, -26.9, 2, 2, 14, "plain"],
    ["desktop", "Desktop", 7.8, 24.7, 3, 3, 18, "lens"],
    ["website", "Website", -9.2, -23.3, 3, 2, 12, "cantilever"],
    ["files", "Files", -26.2, 6.4, 2, 2, 24, "stilts"],
    ["isle", "Isle", 24, -7.1, 2, 2, 28, "twist", { twist: 3.2 }],
    ["party", "Keyboard party", -23.3, -12, 2, 2, 16, "plain"],
    ["", "", -18.4, -4.2, 2, 2, 46, "pyramid"],
    ["", "", -0.7, -24.7, 2, 2, 38, "pyramid"],
    ["", "", 17.7, -23.3, 2, 2, 32, "pyramid"],
    ["", "", 15.6, 21.2, 2, 2, 28, "pyramid"],
    ["", "", -19.8, 22.6, 2, 2, 18, "stilts"],
    ["", "", -27.6, -3.5, 2, 2, 34, "twist", { twist: -3 }],
  ];
  for (const [key, name, tx, ty, w, d, floors, kind, extra] of PLAN) {
    const s = w > 2 ? 6 : 4;
    const x = 2 * Math.round((CX + tx - s / 2) / 2);
    const y = 2 * Math.round((CY + ty - s / 2) / 2);
    lots.push(lot({ x, y, s, w, d, floors, kind, name, key, ...extra }));
  }

  // -- the ground: a height map in terraces (how many layers of bricks), on a 2-stud grid
  const hg = new Int8Array(G * G);
  const hAt = (i: number, j: number) => hg[i + j * G] ?? 0;
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) {
      const x = 2 * i + 1;
      const y = 2 * j + 1;
      const d = fromCentre(x, y);
      const n = relief(x, y);
      const island = fromFirst(x, y) < 8 + 3 * nB(x / 5, y / 5);
      if (d > shore(x, y) && !island) continue;
      let h = Math.round(1.1 + 2.6 * n + 1.4 * (1 - d / RIM));
      if (island) h = Math.max(h, 2); // the first app's patch
      hg[i + j * G] = Math.max(0, Math.min(5, h));
    }
  const setH = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    f: (h: number) => number,
  ) => {
    for (let j = y0 / 2; j < y1 / 2; j++)
      for (let i = x0 / 2; i < x1 / 2; i++)
        if (i >= 0 && j >= 0 && i < G && j < G) hg[i + j * G] = f(hAt(i, j));
  };
  // every tower stands on solid ground, a little above its surroundings
  for (const l of lots) {
    let top = 2;
    for (let j = l.y / 2; j < (l.y + l.s) / 2; j++)
      for (let i = l.x / 2; i < (l.x + l.s) / 2; i++)
        top = Math.max(top, hAt(i, j));
    l.base = l.mega ? 5 : l.kind === "first" ? 4 : top;
    setH(l.x, l.y, l.x + l.s, l.y + l.s, () => l.base);
    if (l.mega)
      setH(l.x - 2, l.y - 2, l.x + l.s + 2, l.y + l.s + 2, (h) =>
        Math.max(h, 4),
      );
  }
  setH(HX, HY, HX + 4, HY + 2, () => 2);
  setH(HX - 4, HY, HX, HY + 2, () => 1);
  setH(HX - 4, HY + 2, HX + 8, HY + 6, (h) => Math.min(h, 1));
  setH(HX + 4, HY - 2, HX + 8, HY + 2, (h) => Math.min(h, 1));
  // the backend: three bricks locked together into one piece beside the first app's base, with open ground to slide out over
  const SWAP: readonly (readonly [number, number, number, number, number])[] = [
    [CHX + 4, CHY, 1, 4, 4],
    [CHX + 4, CHY, 2, 2, 4],
    [CHX + 6, CHY + 2, 2, 2, 2],
  ];
  setH(CHX + 4, CHY, CHX + 8, CHY + 4, () => 2);
  setH(CHX + 4, CHY, CHX + 6, CHY + 4, () => 3);
  setH(CHX + 6, CHY + 2, CHX + 8, CHY + 4, () => 3);
  setH(CHX + 8, CHY, CHX + 20, CHY + 4, (h) => Math.min(h, 1));

  interface Reserved {
    x: number;
    y: number;
    z: number;
    w: number;
    d: number;
    h: number;
    c?: number;
    t0?: number;
    dur?: number;
    extra: Partial<Block>;
  }
  const reserved: Reserved[] = [
    // chapter 0: the one plugin, in two halves (server below, browser above) that close into one brick
    {
      x: HX,
      y: HY,
      z: 0,
      w: 4,
      d: 2,
      h: 0.5,
      t0: -1,
      extra: { role: "hero", k: 0 },
    },
    {
      x: HX,
      y: HY,
      z: 0.5,
      w: 4,
      d: 2,
      h: 0.5,
      t0: -1,
      extra: { studs: 1, role: "hero", k: 1 },
    },
    // chapter 1: two plugins land on its studs, one snaps on beside it
    {
      x: HX,
      y: HY,
      z: 1,
      w: 2,
      d: 2,
      h: 1,
      t0: 0.36,
      dur: 0.2,
      extra: { drop: 3.5, studs: 1, role: "early" },
    },
    {
      x: HX + 2,
      y: HY,
      z: 1,
      w: 2,
      d: 2,
      h: 1,
      t0: 0.64,
      dur: 0.2,
      extra: { drop: 3.5, studs: 1, role: "early" },
    },
    {
      x: HX - 4,
      y: HY,
      z: 0,
      w: 4,
      d: 2,
      h: 1,
      t0: 0.52,
      dur: 0.25,
      extra: { drop: 3.5, studs: 1, role: "early" },
    },
    // the backend bricks that get swapped (same places, two sets)
    ...SWAP.flatMap(([x, y, z, w, d]): Reserved[] => [
      { x, y, z, w, d, h: 1, extra: { studs: 1, role: "swapOld" } },
      { x, y, z, w, d, h: 1, c: PICK, extra: { studs: 1, role: "swapNew" } },
    ]),
  ];
  const SIZES: readonly (readonly [number, number])[] = [
    [2, 2],
    [2, 2],
    [4, 2],
    [2, 4],
    [4, 2],
    [2, 4],
    [4, 4],
    [4, 4],
    [6, 2],
    [2, 6],
    [6, 4],
    [4, 6],
  ];
  for (let L = 0; L < 5; L++) {
    const used = new Uint8Array(N * N);
    const mark = (x: number, y: number, w: number, d: number) => {
      for (let i = x; i < x + w; i++)
        for (let j = y; j < y + d; j++) used[i + j * N] = 1;
    };
    const has = (x: number, y: number) =>
      x < N && y < N && hAt(x >> 1, y >> 1) > L;
    const free = (x: number, y: number, w: number, d: number) => {
      for (let i = x; i < x + w; i += 2)
        for (let j = y; j < y + d; j += 2)
          if (!has(i, j) || used[i + j * N]) return false;
      return true;
    };
    const open = (x: number, y: number, w: number, d: number) => {
      for (let i = x; i < x + w; i += 2)
        for (let j = y; j < y + d; j += 2)
          if (hAt(i >> 1, j >> 1) === L + 1) return 1;
      return 0;
    };
    // the island under the first app arrives in chapter 2; the rest spreads out from it when the city is built
    const arrive = (x: number, y: number, w: number, d: number) => {
      const dc = fromFirst(x + w / 2, y + d / 2);
      return dc < 9 + 3 * nB((x + 1) / 5, (y + 1) / 5) + 1
        ? 1.1 + L * 0.13 + (dc / 12) * 0.28 + rnd() * 0.04
        : 5.02 + L * 0.03 + Math.min(1, dc / 62) * 0.46 + rnd() * 0.04;
    };
    for (const r of reserved)
      if (Math.floor(r.z + 0.001) === L) {
        if (!used[r.x + r.y * N]) mark(r.x, r.y, r.w, r.d);
        add(
          r.x,
          r.y,
          r.z,
          r.w,
          r.d,
          r.h,
          r.c ?? L,
          r.t0 ?? arrive(r.x, r.y, r.w, r.d),
          r.dur ?? 0.16,
          r.extra,
        );
      }
    for (let y = 0; y < N; y += 2)
      for (let x = 0; x < N; x += 2) {
        if (!has(x, y) || used[x + y * N]) continue;
        let [w, d] = must(SIZES[Math.floor(rnd() * SIZES.length)], "size");
        if (!free(x, y, w, d)) {
          w = 2;
          d = 2;
        }
        mark(x, y, w, d);
        const t0 = arrive(x, y, w, d);
        add(x, y, L, w, d, 1, L, t0, t0 < 3 ? 0.16 : 0.1, {
          studs: open(x, y, w, d),
          role: "found",
        });
      }
  }

  // -- towers. Every tower is one of a few shapes; all of them are bricks, and the bricks of one
  //    tower that share a level share a height.
  const towers: Tower[] = [];
  const DEG = Math.PI / 180;
  const STEPS: readonly (readonly [number, number])[] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  function tower(l: Lot) {
    const id = towers.length;
    const lx = l.x;
    const ly = l.y;
    const S = l.s;
    const floors = l.floors;
    const kind = l.kind;
    const first = kind === "first";
    const u = TS;
    // thin floors, as on a real tower
    const FH = first ? 0.5 : 0.45 * u;
    const cx = lx + S / 2;
    const cy = ly + S / 2;
    let tip: Vec3 = [cx, cy, l.base + floors / 2];
    // each tower starts on its own beat, the ones further from the first app a little later
    const base = first
      ? 2.12
      : 5.12 +
        Math.min(1, fromFirst(cx, cy) / 62) * 0.36 +
        ((id * 0.618) % 1) * 0.1;
    const span = first ? 0.66 : 0.3;
    const dur = 0.14;
    const total = floors + 6;
    const jit = () => (first ? 0 : (((blocks.length * 7919) % 97) / 97) * 0.03);
    const put = (
      x: number,
      y: number,
      z: number,
      w: number,
      d: number,
      h: number,
      c: number,
      extra?: Partial<Block>,
    ) =>
      add(
        r1(x),
        r1(y),
        z,
        r1(w),
        r1(d),
        h * FH,
        c,
        base + ((z - l.base) / (total * FH)) * span + jit(),
        dur,
        { group: id, drop: 12, role: "tower", ...extra },
      );
    const turned = (rot: number): Partial<Block> | undefined =>
      rot ? { rot, px: cx, py: cy } : undefined;
    const spire = (x: number, y: number, z: number, sh: number) => {
      put(x - 0.3, y - 0.3, z, 0.6, 0.6, sh / FH, LIT);
      put(x - 0.1, y - 0.1, z + sh, 0.2, 0.2, (sh + 1) / FH, LIT);
      tip = [x, y, z + sh * 2 + 1];
    };
    const split = (
      x: number,
      y: number,
      z: number,
      w: number,
      d: number,
      along: boolean,
      c: number,
    ) => {
      if (along) {
        put(x, y, z, w / 2, d, 1, c);
        put(x + w / 2, y, z, w / 2, d, 1, c);
      } else {
        put(x, y, z, w, d / 2, 1, c);
        put(x, y + d / 2, z, w, d / 2, 1, c);
      }
    };
    // a floor is one glass slab, or two halves split on the same axis all the way up (a seam like a mullion): each slab one plugin
    const slab = (
      z: number,
      w: number,
      d: number,
      ox = 0,
      oy = 0,
      rot = 0,
      c = TOWER,
    ) => {
      const x = cx - w / 2 + ox;
      const y = cy - d / 2 + oy;
      const e = turned(rot);
      if (w < 2 && d < 2) put(x, y, z, w, d, 1, c, e);
      else if (w >= d) {
        put(x, y, z, w / 2, d, 1, c, e);
        put(x + w / 2, y, z, w / 2, d, 1, c, e);
      } else {
        put(x, y, z, w, d / 2, 1, c, e);
        put(x, y + d / 2, z, w, d / 2, 1, c, e);
      }
    };
    // a thin halo: four bars round the floor
    const halo = (
      z: number,
      size: number,
      rot = 0,
      c = TOWER,
      t = 0.35 * u,
      h = 0.1 * u,
    ) => {
      const x0 = cx - size / 2;
      const y0 = cy - size / 2;
      const e = turned(rot);
      const hh = h / FH;
      put(x0, y0, z, size, t, hh, c, e);
      put(x0, y0 + size - t, z, size, t, hh, c, e);
      put(x0, y0 + t, z, t, size - 2 * t, hh, c, e);
      put(x0 + size - t, y0 + t, z, t, size - 2 * t, hh, c, e);
    };
    const mast = (z: number, len: number, rot = 0, c = TOWER) => {
      put(cx - 0.12, cy - 0.12, z, 0.24, 0.24, len / FH, c, turned(rot));
      tip = [cx, cy, z + len];
    };
    const W = l.w * u;
    const D = l.d * u;
    let needle = l.needle;
    let z = l.base;
    switch (kind) {
      // every floor turned a little further around the tower's axis (halo rings optional)
      case "twist":
        for (let k = 0; k < floors; k++, z += FH) {
          const rot = k * l.twist * DEG;
          slab(z, W, D, 0, 0, rot);
          if (l.rings && k % l.rings === l.rings - 1)
            halo(z + FH - 0.03 * u, W + 2.4 * u, rot);
        }
        break;
      // a thin stem swelling to its full width at ~60% of its height, then narrowing again
      case "lens":
        for (let k = 0; k < floors; k++, z += FH) {
          const f = k / floors;
          const w =
            u *
            Math.max(
              1,
              Math.round(
                2 *
                  (1 +
                    (l.w - 1) *
                      Math.pow(Math.sin(Math.PI * Math.min(1, f / 1.15)), 0.7)),
              ) / 2,
            );
          slab(z, w, w);
        }
        break;
      // blocks of floors, each pushed out one step toward the next side
      case "cantilever":
        for (let k = 0; k < floors; k++, z += FH) {
          const [sx, sy] = must(STEPS[Math.floor(k / 7) % 4], "step");
          slab(z, W, D, sx * 0.6 * u, sy * 0.6 * u);
        }
        break;
      // a thin core, a wide overhanging body, a thin core again, a cap
      case "stilts":
        for (let k = 0; k < floors; k++, z += FH) {
          const f = k / floors;
          if (f < 0.3 || (f >= 0.7 && f < 0.82)) slab(z, u, u);
          else if (f < 0.7) slab(z, W + u, D + u);
          else slab(z, W, D);
        }
        break;
      // a straight shaft with a ring for a crown
      case "plain":
        for (let k = 0; k < floors; k++, z += FH) slab(z, W, D);
        halo(z - 0.03 * u, W + 1.6 * u);
        break;
      // a slim pyramid: floors shrinking to a point, its tip cut loose and hovering over a halo
      case "pyramid": {
        const cut = Math.round(floors * 0.74);
        for (let k = 0; k < floors; k++, z += FH) {
          const w = r1(lerp(W, 0.3, Math.pow(k / floors, 0.9)));
          if (k === cut) halo(z + FH * 0.3, w + 1.8 * u, 0, LIT, 0.25 * u);
          if (k < cut || k > cut + 1)
            slab(
              z,
              w,
              w,
              0,
              0,
              0,
              k === cut - 1 || k === cut + 2 ? LIT : TOWER,
            );
        }
        needle = 2.2;
        break;
      }
      // the first app: a slim shaft with a wider head, one floor of it the feature that gets removed
      case "first":
        for (let k = 0; k < 16; k++, z += FH) {
          if (k === 10 || k === 11) {
            put(lx + 0.5, ly + 0.5, z, 1.5, 3, 1, LIT, { role: "removed" });
            put(lx + 2, ly + 0.5, z, 1.5, 3, 1, LIT, { role: "removed" });
          } else
            split(
              lx + 0.5,
              ly + 0.5,
              z,
              3,
              3,
              (k >> 1) % 2 === 1,
              k === 4 || k === 5 ? LIT : TOWER,
            );
        }
        for (let k = 0; k < 6; k++, z += FH) {
          put(lx, ly, z, 2, 2, 1, TOWER);
          put(lx + 2, ly, z, 2, 2, 1, k === 2 || k === 3 ? LIT : TOWER);
          put(lx, ly + 2, z, 2, 2, 1, TOWER);
          put(lx + 2, ly + 2, z, 2, 2, 1, TOWER);
        }
        halo(z - 1.2, 6, 0, LIT, 0.4, 0.1);
        put(lx + 1, ly + 1, z + 0.5, 2, 2, 0.4, LIT);
        spire(lx + 2, ly + 2, z + 0.5, 1);
        break;
    }
    if (!first) {
      tip = [cx, cy, z];
      if (needle)
        mast(
          z,
          needle * u,
          kind === "twist" ? (floors - 1) * l.twist * DEG : 0,
          kind === "pyramid" ? LIT : TOWER,
        );
    }
    towers.push({
      id,
      S,
      name: l.name,
      key: l.key,
      cx,
      cy,
      tip,
      base: l.base,
      FH,
    });
  }
  lots.forEach(tower);
  const agent = must(towers[0], "Agent manager");
  const first = must(towers[1], "first app");

  // sky-bridges between towers of one family: a thin glass tube at a shared floor
  const byKey = (key: string) =>
    must(
      towers.find((t) => t.key === key),
      `tower ${key}`,
    );
  for (const [from, to, k] of [
    ["sonata", "events", 22],
    ["pages", "chord", 22],
    ["agent", "home", 18],
  ] as const) {
    const A = byKey(from);
    const B = byKey(to);
    const z = Math.max(A.base, B.base) + k * A.FH + 0.15;
    const th = 0.6;
    const h = 0.38;
    const x0 = Math.min(A.cx, B.cx);
    const x1 = Math.max(A.cx, B.cx);
    const y0 = Math.min(A.cy, B.cy);
    const y1 = Math.max(A.cy, B.cy);
    const bar = (x: number, y: number, w: number, d: number) =>
      add(r1(x), r1(y), z, r1(w), r1(d), h, TOWER, 5.92, 0.08, {
        group: A.id,
        drop: 12,
        role: "tower",
        bridge: true,
      });
    if (x1 - x0 >= y1 - y0) {
      bar(x0, A.cy - th / 2, x1 - x0, th);
      if (y1 > y0 + 0.1) bar((B.cx === x1 ? x1 : x0) - th / 2, y0, th, y1 - y0);
    } else {
      bar(A.cx - th / 2, y0, th, y1 - y0);
      if (x1 > x0 + 0.1) bar(x0, (B.cy === y1 ? y1 : y0) - th / 2, x1 - x0, th);
    }
  }
  // the five apps nearest to the first one ship with it at the end
  const pack = towers
    .slice(2)
    .filter((t) => t.name)
    .sort((a, b) => fromFirst(a.cx, a.cy) - fromFirst(b.cx, b.cy))
    .slice(0, 5);

  // -- sub-systems: the foundation in neighbourhoods, each one a thing every app needs. A brick belongs to
  //    the nearest one; within it, each brick is one plugin.
  const SYSTEMS: readonly (readonly [
    string,
    string,
    number,
    number,
    readonly string[],
  ])[] = [
    [
      "Database",
      "where every app keeps its data",
      CHX + 6,
      CHY + 2,
      ["Save data", "Load data", "Data changes", "Data safety"],
    ],
    [
      "Buttons, lists & forms",
      "the building blocks of every screen",
      CHX + 3,
      CHY + 8,
      ["Buttons", "Lists", "Forms", "Menus", "Dialogs", "Text editor"],
    ],
    [
      "Accounts & sign-in",
      "who you are, in every app",
      CHX - 5,
      CHY - 1,
      ["Sign in", "Sign out", "Profiles", "Passwords"],
    ],
    [
      "Search",
      "find anything, in any app",
      CHX + 1,
      CHY - 7,
      ["Search box", "Search index", "Filters"],
    ],
    [
      "Notifications",
      "how any app gets your attention",
      CHX - 6,
      CHY + 6,
      ["Alerts", "Badges", "Reminders"],
    ],
    [
      "File storage",
      "photos, attachments, documents",
      CHX + 9,
      CHY - 5,
      ["Uploads", "Downloads", "Attachments"],
    ],
    [
      "Themes & dark mode",
      "one look across every app",
      CHX + 9,
      CHY + 8,
      ["Colours", "Dark mode", "Fonts"],
    ],
    [
      "Windows & tabs",
      "how apps sit on your screen",
      36,
      48,
      ["Tabs", "Side panels", "Split view"],
    ],
    [
      "Keyboard shortcuts",
      "the same keys in every app",
      34,
      36,
      ["Shortcuts", "Command menu"],
    ],
    [
      "Live updates",
      "changes show up everywhere at once",
      38,
      24,
      ["Live refresh", "Sync"],
    ],
    [
      "Settings",
      "one place for every preference",
      25,
      30,
      ["Preferences", "Options page"],
    ],
    [
      "Undo & history",
      "go back to any earlier version",
      23,
      42,
      ["Undo", "Version history"],
    ],
    [
      "Scheduled tasks",
      "work that runs while you are away",
      29,
      54,
      ["Timers", "Queues"],
    ],
    [
      "Sharing & permissions",
      "who can see and change what",
      46,
      24,
      ["Share links", "Permissions"],
    ],
    ["Backups", "nothing is ever lost", 54, 28, ["Backup", "Restore"]],
  ];
  const systems: SubSystem[] = SYSTEMS.map(
    ([name, sub, x, y, plugins], id) => ({
      id,
      name,
      sub,
      x,
      y,
      plugins,
      n: 0,
    }),
  );
  for (const b of blocks) {
    if (b.group >= 0) continue;
    if (b.role === "swapOld" || b.role === "swapNew") b.sys = 0;
    else {
      let bd = 1e9;
      for (const S of systems) {
        const d = Math.hypot(b.x + b.w / 2 - S.x, b.y + b.d / 2 - S.y);
        if (d < bd) {
          bd = d;
          b.sys = S.id;
        }
      }
    }
    const S = must(systems[b.sys], "sub-system");
    b.plugin = must(S.plugins[S.n++ % S.plugins.length], "plugin name");
  }
  for (const b of blocks) if (b.role === "hero") b.plugin = "Toolbar";
  const early = blocks.filter((b) => b.role === "early");
  ["Search button", "Share button", "Status bar"].forEach((n, i) => {
    const b = early[i];
    if (b) b.plugin = n;
  });

  // draw order: bottom-up, then far-to-near. Correct for bricks that don't overlap in height.
  blocks.sort(
    (a, b) =>
      a.z - b.z ||
      a.x + a.w / 2 + a.y + a.d / 2 - (b.x + b.w / 2 + b.y + b.d / 2),
  );
  blocks.forEach((b, i) => {
    b.i = i;
    b.flat = b.h < 0.2 || b.w < 0.7 || b.d < 0.7;
  });
  const firstOf = towers.map((t) => blocks.findIndex((b) => b.group === t.id));

  // -- standalone builds: the towers picked, the ground under them and the shared bricks around them that they use
  const SPECS: readonly {
    ids: readonly number[];
    reach: number;
    share: number;
    lite?: boolean;
  }[] = [
    { ids: [first.id], reach: 9, share: 0.3 },
    { ids: [agent.id], reach: 14, share: 0.45 },
    // the same app with some features left out
    { ids: [agent.id], reach: 10, share: 0.3, lite: true },
    { ids: [first.id, ...pack.map((t) => t.id)], reach: 9, share: 0.4 },
  ];
  let amLo = 1e9;
  let amHi = -1e9;
  for (const b of blocks)
    if (b.group === agent.id && b.w > 0.7) {
      amLo = Math.min(amLo, b.z);
      amHi = Math.max(amHi, b.z);
    }
  const builds: Build[] = SPECS.map((B) => {
    const sel = new Uint8Array(blocks.length);
    const ts = B.ids.map((id) => must(towers[id], "build tower"));
    for (const b of blocks) {
      let s = false;
      if (b.role === "swapOld" || b.role === "removed") s = false;
      else if (b.group >= 0) {
        s = B.ids.includes(b.group);
        if (s && B.lite) {
          const r = (b.z - amLo) / (amHi - amLo);
          if (
            (r > 0.26 && r < 0.38) ||
            (r > 0.58 && r < 0.66) ||
            b.h < 0.2 ||
            b.bridge
          )
            s = false;
        }
      } else {
        const bx = b.x + b.w / 2;
        const by = b.y + b.d / 2;
        s = ts.some((t) => {
          const d =
            Math.max(Math.abs(bx - t.cx), Math.abs(by - t.cy)) - t.S / 2;
          return (
            d < 2.5 || (d < B.reach && rnd() < B.share * (1 - d / B.reach))
          );
        });
      }
      if (s) sel[b.i] = 1;
    }
    const delay = new Float32Array(blocks.length);
    for (const b of blocks) {
      const bx = b.x + b.w / 2;
      const by = b.y + b.d / 2;
      let d = 1e9;
      for (const t of ts)
        d = Math.min(d, Math.hypot(bx - t.cx, by - t.cy, (b.z - t.base) * 0.7));
      delay[b.i] = 0.32 * clamp01(d / 34);
    }
    return { sel, delay };
  });

  // Studs, on the bricks that carry them. They are gone before the first app's chapter, so only the
  // bricks that have landed by then get any.
  const studs: Stud[] = [];
  for (const b of blocks)
    if (b.studs && (b.t0 < 3 || b.role === "swapOld" || b.role === "swapNew"))
      for (let j = 0; j < b.d; j++)
        for (let i = 0; i < b.w; i++)
          studs.push({ b, ox: i + 0.5, oy: j + 0.5 });

  return { blocks, towers, systems, builds, studs, agent, first, firstOf };
}
