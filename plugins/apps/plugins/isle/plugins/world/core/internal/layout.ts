// The revealed world: from the placement, which islands show, which roads are
// built (the trunks the districts need, their streets as far as their last
// plot, every door's lane, bridges and ferries), which squares, buildings and
// empty lots stand. Pure data — what the renderer draws and the walker walks.

import { fnv1a32 } from "@plugins/packages/plugins/string-hash/core";
import type { Box } from "@plugins/apps/plugins/isle/plugins/buildings/core";
import {
  boxField,
  cellKey,
  cheapestWay,
  drawnInto,
  fair,
  meander,
  pathNet,
  resampled,
  STEP,
  type PathNet,
} from "./footpath";
import { arcsOf, cutAt, roadCurve, type Pt } from "./geometry";
import { vnoise } from "./noise";
import {
  districtGroup,
  type Placement,
  type Plot,
  type Resident,
} from "./placement";
import { ROAD_R, trunkOf } from "./roads";
import { placed, plotBox, sitesOf } from "./sites";
import type { Island, Slot, WorldModel } from "./world-model";

export type RoadKind = "trunk" | "street" | "lane" | "spur" | "link";

export interface RoadSample {
  readonly x: number;
  readonly y: number;
  /** The road's direction here. */
  readonly ux: number;
  readonly uy: number;
  /** Half-width here, px. */
  readonly r: number;
  /** On or right beside water: a bridge plank. */
  readonly bridge: boolean;
}

export interface Road {
  /** Stable across layouts while the road is the same. */
  readonly key: string;
  readonly pts: readonly Pt[];
  readonly kind: RoadKind;
  /** Half-width, px. */
  readonly R: number;
  /** How trodden it is, 0..1: a little-used spur is thinner and fainter. */
  readonly wear: number;
  /** Samples every 4 px. */
  readonly samples: readonly RoadSample[];
  readonly bbox: Box;
}

export interface Square {
  readonly key: string;
  readonly slot: string;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** Busy enough for a well. */
  readonly well: boolean;
  /** The busiest home square holds the campfire. */
  readonly camp: boolean;
  readonly n: number;
}

export interface PlacedBuilding {
  readonly appId: string;
  readonly plot: Plot;
  readonly x: number;
  readonly y: number;
  /** Its solid base (from the footprint). */
  readonly w: number;
  readonly depth: number;
  /** Its signpost's x, door-relative. */
  readonly signX: number;
  /** Everything its plot reserves, world px. */
  readonly box: Box;
  readonly door: Pt;
}

export interface Ferry {
  readonly key: string;
  readonly a: Pt;
  readonly b: Pt;
  /** Phase offset of the crossing, 0..1. */
  readonly ph: number;
}

export interface Pier {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly ang: number;
}

export interface Layout {
  readonly islands: readonly Island[];
  /** Districts with at least one shown plot. */
  readonly active: readonly Slot[];
  readonly roads: readonly Road[];
  readonly squares: readonly Square[];
  readonly buildings: readonly PlacedBuilding[];
  /** Plots nobody present stands on. */
  readonly lots: readonly Plot[];
  readonly ferries: readonly Ferry[];
  readonly piers: readonly Pier[];
  /** The home dock, when home shows. */
  readonly dock: {
    readonly at: Pt;
    readonly nx: number;
    readonly ny: number;
  } | null;
  /** The world's extent: every revealed island, with sea round it. */
  readonly rect: Box;
}

/** How a road's width swells at its ends: by `k` × its width, over about `over` px. */
interface Flare {
  readonly k: number;
  readonly over: number;
}

function roadSamples(
  pts: readonly Pt[],
  R: number,
  height: (x: number, y: number) => number,
  wear: number,
  head: Flare,
  tail: Flare,
): { samples: RoadSample[]; bbox: Box } {
  const total = arcsOf(pts).at(-1) ?? 0;
  let done = 0;
  const out: {
    x: number;
    y: number;
    ux: number;
    uy: number;
    r: number;
    wet: boolean;
  }[] = [];
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 0.01) continue;
    const ux = (bx - ax) / L;
    const uy = (by - ay) / L;
    for (let s = 0; s < L; s += 4) {
      const x = ax + ux * s;
      const y = ay + uy * s;
      out.push({
        x,
        y,
        ux,
        uy,
        // a worn way's width: slow swells and pinches, a little raggedness,
        // and trodden wider where it starts and ends (a door, a junction)
        r:
          R *
          (0.52 + wear * 0.26) *
          (0.74 +
            vnoise(x / 96 + 13.7, y / 96 + 4.1) * 0.5 +
            vnoise(x / 24, y / 24) * 0.2) *
          (1 +
            head.k * Math.exp(-(((done + s) / head.over) ** 2)) +
            tail.k * Math.exp(-(((total - done - s) / tail.over) ** 2))),
        wet: height(x, y) < 0.04,
      });
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    done += L;
  }
  const samples = out.map((s, i) => ({
    x: s.x,
    y: s.y,
    ux: s.ux,
    uy: s.uy,
    r: s.r,
    bridge:
      s.wet ||
      out[Math.max(0, i - 4)]!.wet ||
      out[Math.min(out.length - 1, i + 4)]!.wet,
  }));
  return { samples, bbox: [x0 - 40, y0 - 40, x1 + 40, y1 + 40] };
}

interface RawRoad {
  readonly key: string;
  readonly pts: readonly Pt[];
  readonly kind: RoadKind;
  readonly R: number;
}
interface WornRoad extends RawRoad {
  readonly wear: number;
  readonly head: Flare;
  readonly tail: Flare;
}

const NO_FLARE: Flare = { k: 0, over: 1 };
/** The furthest (px) a road may be worn from its routed line. */
const WORN_REACH = { main: 150, lane: 48 } as const;
/** How far (px) a lane keeps from a plot's ground band, and how far a door looks for a road. */
const LANE_CLEAR = 12;
const LANE_REACH = 1400;
/** How far (px) in front of its building's wall a lane keeps while it crosses its own yard. */
const YARD_OUT = 20;

/**
 * The routed roads worn into footpaths (`footpath.ts`): each drawn into a road
 * already laid that it runs beside (two trunks leaving a square down the same
 * street, a lane along a street), its corners worn round as far as the ground
 * is open — a point keeps as near its routed line as the nearest plot's band
 * requires, so a road bends away from nothing that was placed against it —
 * and given a gentle wander. A wearing that would put more of the road in the
 * water is halved until it does not. A bridge, a pier's approach and a ferry
 * road stay as routed.
 */
function wornRoads(
  roads: readonly RawRoad[],
  laneOf: ReadonlyMap<string, { plot: Plot; band: number }>,
  bands: readonly Box[],
  height: (x: number, y: number) => number,
  squares: readonly Square[],
): WornRoad[] {
  const net: PathNet = pathNet();
  const near = boxField(bands, WORN_REACH.main + 30);
  const wet = (pts: readonly Pt[]) => {
    let n = 0;
    for (let i = 0; i < pts.length; i += 2)
      if (height(pts[i]![0], pts[i]![1]) < 0.07) n++;
    return n;
  };
  /** `base` worn round, each point as far as `room(i)` px lets it go. */
  const worn = (
    base: readonly Pt[],
    room: (i: number) => number,
    passes: number,
    wander: number,
  ): Pt[] => {
    const caps = base.map((_, i) => room(i));
    const dry = wet(base);
    for (let k = 1; k > 0.1; k /= 2) {
      const q = meander(
        fair(
          base,
          caps.map((c) => c * k * 0.75),
          Math.round(passes * k),
        ),
        // it wanders only as far as it has room: the rest of its reach
        caps.map((c) => Math.min(wander, c * 0.25) * k),
      );
      if (wet(q) <= dry) return q;
    }
    return [...base];
  };
  const main = new Map<RawRoad, Pt[]>();
  for (const r of roads) {
    if (laneOf.has(r.key)) continue;
    let pts: Pt[];
    if (r.kind === "link" || r.pts.length < 3) pts = [...r.pts];
    else {
      const base = drawnInto(resampled(r.pts, 8), net, 0);
      pts = worn(
        base,
        (i) =>
          Math.max(
            0,
            Math.min(
              WORN_REACH.main,
              near.dist(base[i]![0], base[i]![1]) - r.R,
            ),
          ),
        360,
        24,
      );
    }
    main.set(r, pts);
    net.add(pts);
  }
  // The doors' lanes: each the cheapest way from its door to the network as
  // it stands — a trunk, a street, a square, or a lane already laid — so
  // neighbours share one lane, none runs beside another and the whole is about
  // as short as it can be. The doors nearest a road are joined first (a far
  // door then finds its neighbours' lanes on its way). A plot's stored `lane`
  // is the way placement proved it has; it is what is laid only when no way
  // is found within reach.
  // what lies at a point, the same for every door: -3 water, -2 more than
  // one band within LANE_CLEAR, -1 open ground, else the one band that near
  // (kept per cell of the search grid, where nearly every question is asked)
  const groundMemo = new Map<number, number>();
  const groundAt = (x: number, y: number): number => {
    const i = x / STEP;
    const j = y / STEP;
    const onGrid = Number.isInteger(i) && Number.isInteger(j);
    let v = onGrid ? groundMemo.get(cellKey(i, j)) : undefined;
    if (v === undefined) {
      v = height(x, y) > 0.08 ? near.within(x, y, LANE_CLEAR) : -3;
      if (onGrid) groundMemo.set(cellKey(i, j), v);
    }
    return v;
  };
  const squareCells = new Set<number>();
  for (const sq of squares) {
    const n = Math.ceil((sq.r * 0.8) / STEP);
    const ci = Math.round(sq.x / STEP);
    const cj = Math.round(sq.y / STEP);
    for (let di = -n; di <= n; di++)
      for (let dj = -n; dj <= n; dj++)
        if (Math.hypot(di, dj) * STEP < sq.r * 0.8)
          squareCells.add(cellKey(ci + di, cj + dj));
  }
  const groundOf = (r: RawRoad, own: { plot: Plot; band: number }) => {
    const { plot, band } = own;
    const G = bands[band]!;
    const door = r.pts[0]!;
    // its own band is in its way only behind its front: the yard is its own to
    // cross — straight out from the door first, then no nearer the front wall
    // than YARD_OUT (a lane does not run along the facade)
    const ownRoom = (x: number, y: number, front: number) => {
      const dx = x < G[0] ? G[0] - x : x > G[2] ? x - G[2] : 0;
      const dy =
        y < G[1] ? G[1] - y : y > plot.y + front ? y - plot.y - front : 0;
      return Math.hypot(dx, dy);
    };
    const free = (x: number, y: number) => {
      const at = groundAt(x, y);
      return (
        (at === -1 || at === band) &&
        ((Math.abs(x - plot.x) < 14 && y >= plot.y) ||
          ownRoom(x, y, YARD_OUT) >= LANE_CLEAR)
      );
    };
    // (asked of the search grid's cells only)
    const goal = (x: number, y: number): Pt | null =>
      net.at(x, y) ??
      (squareCells.has(cellKey(x / STEP, y / STEP)) ? [x, y] : null);
    return { plot, band, door, ownRoom, free, goal };
  };
  const lanes = roads
    .map((r, at) => ({ r, at, own: laneOf.get(r.key) }))
    .filter(
      (e): e is typeof e & { own: { plot: Plot; band: number } } => !!e.own,
    )
    .map((e) => {
      const G = groundOf(e.r, e.own);
      const first = cheapestWay(G.door, G.free, G.goal, LANE_REACH);
      return {
        ...e,
        G,
        first,
        far: first ? (arcsOf(first).at(-1) ?? 0) : Infinity,
      };
    })
    .sort((a, b) => a.far - b.far || a.own.plot.seq - b.own.plot.seq);
  const laid = new Map<RawRoad, { pts: Pt[]; joined: number }>();
  /** How many later lanes join each lane (by its place in `roads`). */
  const users = new Map<number, number>();
  const laidBoxes: Box[] = [];
  for (const { r, at, G: ground, far, first } of lanes) {
    const { band, door, ownRoom, free, goal } = ground;
    // (its first way stands unless a lane laid since comes nearer than the road it found)
    const nearer = laidBoxes.some(
      (B) =>
        Math.hypot(
          door[0] < B[0] ? B[0] - door[0] : door[0] > B[2] ? door[0] - B[2] : 0,
          door[1] < B[1] ? B[1] - door[1] : door[1] > B[3] ? door[1] - B[3] : 0,
        ) < far,
    );
    const way = (nearer
      ? cheapestWay(door, free, goal, LANE_REACH)
      : first) ?? [...r.pts];
    const end = way[way.length - 1]!;
    const joined = net.nearest(end[0], end[1], 2)?.tag ?? -1;
    if (joined >= 0) users.set(joined, (users.get(joined) ?? 0) + 1);
    const base = resampled(way, 8);
    const pts = worn(
      base,
      (i) => {
        const [x, y] = base[i]!;
        return Math.max(
          0,
          Math.min(
            WORN_REACH.lane,
            near.dist(x, y, band) - LANE_CLEAR,
            ownRoom(x, y, YARD_OUT - 14) - 4,
          ),
        );
      },
      56,
      11,
    );
    net.add(pts, at);
    laid.set(r, { pts, joined });
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (const [x, y] of pts) {
      bx0 = Math.min(bx0, x);
      by0 = Math.min(by0, y);
      bx1 = Math.max(bx1, x);
      by1 = Math.max(by1, y);
    }
    laidBoxes.push([bx0, by0, bx1, by1]);
  }
  return roads.map((r, at): WornRoad => {
    const m = main.get(r);
    if (m)
      return {
        ...r,
        key: r.pts.length < 3 ? r.key : `${r.key}:${shapeHash(m)}`,
        pts: m,
        wear: 1,
        head: r.kind === "link" ? NO_FLARE : { k: 0.22, over: 46 },
        tail: r.kind === "link" ? NO_FLARE : { k: 0.22, over: 46 },
      };
    const { pts } = laid.get(r)!;
    const len = arcsOf(pts).at(-1) ?? 0;
    // a short spur to one door is trodden less than a lane other doors join
    const wear = Math.min(
      0.9,
      0.3 +
        len / 900 +
        (users.get(at) ?? 0) * 0.22 +
        (fnv1a32(r.key) % 100) / 500,
    );
    return {
      ...r,
      // its shape is part of its name: a lane laid another way is another road to draw
      key: `ln:${shapeHash(pts)}:${r.key.slice(3)}`,
      pts,
      kind: len > 300 ? "lane" : "spur",
      wear,
      // trodden wide before the door, and where it joins the road
      head: { k: 0.5, over: 15 },
      tail: { k: 0.55, over: 22 },
    };
  });
}

/**
 * Trunk roads that meet end to end where nothing else does — a district's
 * node with no square on it — are one road: worn as one, it runs through
 * without a kink where its two routed pieces were joined.
 */
function chained(
  roads: readonly RawRoad[],
  isLane: (r: RawRoad) => boolean,
  squares: readonly Square[],
): RawRoad[] {
  const at = (p: Pt) => `${Math.round(p[0])},${Math.round(p[1])}`;
  const held = new Set(squares.map((q) => at([q.x, q.y])));
  const out = [...roads];
  for (;;) {
    const ends = new Map<string, number[]>();
    out.forEach((r, i) => {
      if (isLane(r) || r.pts.length < 2) return;
      for (const k of new Set([at(r.pts[0]!), at(r.pts[r.pts.length - 1]!)])) {
        const a = ends.get(k);
        if (a) a.push(i);
        else ends.set(k, [i]);
      }
    });
    let joined = false;
    for (const [k, [i, j, more]] of ends) {
      if (i === undefined || j === undefined || more !== undefined) continue;
      const a = out[i]!;
      const b = out[j]!;
      if (held.has(k) || a.kind !== "trunk" || b.kind !== "trunk") continue;
      if (a.pts.length < 3 || b.pts.length < 3) continue;
      const ap =
        at(a.pts[a.pts.length - 1]!) === k ? a.pts : [...a.pts].reverse();
      const bp = at(b.pts[0]!) === k ? b.pts : [...b.pts].reverse();
      out[i] = {
        key: `${a.key}+${b.key}`,
        pts: [...ap, ...bp.slice(1)],
        kind: "trunk",
        R: Math.max(a.R, b.R),
      };
      out.splice(j, 1);
      joined = true;
      break;
    }
    if (!joined) return out;
  }
}

function shapeHash(pts: readonly Pt[]): string {
  let s = "";
  for (const [x, y] of pts) s += `${Math.round(x)},${Math.round(y)};`;
  return fnv1a32(s).toString(36);
}

/**
 * Lays the world out for the present residents (`residents` — the apps shown;
 * a plot whose app is absent is an empty lot).
 */
export function layoutWorld(
  M: WorldModel,
  placement: Placement,
  residents: readonly Resident[],
): Layout {
  const byId = new Map(residents.map((r) => [r.id, r]));
  const occupantOf = new Map<string, string>();
  for (const r of residents) {
    const pid = placement.occupant[r.id];
    if (pid && !occupantOf.has(pid)) occupantOf.set(pid, r.id);
  }
  // a lot given back to nature is not drawn (nor its lane): only its land
  // shows; a retired plot is no land at all
  const shownOf = (s: Slot): readonly Plot[] =>
    (placement.plots[s.id] ?? []).filter(
      (p) => !p.retired && (!p.wild || occupantOf.has(p.id)),
    );
  const active = M.slots.filter(
    (s) => districtGroup(placement, s.id) !== null && shownOf(s).length,
  );
  const activeSet = new Set(active);
  const isl = new Set([0]);
  for (const s of active) {
    let I: Island | null = s.island;
    while (I && !isl.has(I.id)) {
      isl.add(I.id);
      I = I.parent !== null ? M.island(I.parent) : null;
    }
  }
  const islands = M.islands.filter((I) => isl.has(I.id));
  const roads: RawRoad[] = [];
  /** Each lane road's plot (and its band's index), and every shown plot's ground band (what a road keeps off). */
  const laneOf = new Map<string, { plot: Plot; band: number }>();
  const bands: Box[] = [];
  const squares: Square[] = [];
  const lots: Plot[] = [];
  const buildings: PlacedBuilding[] = [];
  const ferries: Ferry[] = [];
  const piers: Pier[] = [];
  const frontLandings = new Set<number>();
  for (const I of islands) {
    const T = trunkOf(M, I);
    const need = new Set<number>();
    const mark = (k0: number) => {
      let k = k0;
      while (k > 0 && !need.has(k)) {
        need.add(k);
        k = T.par[k]!;
      }
    };
    I.slots.forEach((s, k) => {
      if (!activeSet.has(s)) return;
      mark(k + 1);
      for (const p of shownOf(s)) {
        if (p.edge) mark(p.edge);
        if (p.landing !== null) frontLandings.add(p.landing);
      }
    });
    for (const l of T.landings) {
      if (isl.has(l.island) || frontLandings.has(l.island)) {
        mark(l.slotNode);
        roads.push({
          key: `ld:${M.seed}:${l.island}`,
          pts: l.pts,
          kind: "trunk",
          R: 21,
        });
      }
    }
    if (I.home && !need.size && I.slots.length) mark(1);
    need.forEach((k) =>
      roads.push({
        key: `tr:${M.seed}:${I.id}:${k}`,
        pts: T.edges[k - 1]!.pts,
        kind: "trunk",
        R: 22,
      }),
    );
    // a square only where buildings surround it (no empty squares with just a well)
    for (const s of I.slots) {
      if (!activeSet.has(s)) continue;
      const sh = shownOf(s);
      const ring = sh.filter((p) => p.ring).length;
      const near = sh.filter(
        (p) => Math.hypot(p.x - s.x, p.y - s.y) < 560,
      ).length;
      if (ring >= 2 && near >= 3) {
        squares.push({
          key: `${M.seed}:${s.id}`,
          slot: s.id,
          x: s.x,
          y: s.y,
          r: s.r,
          well: near >= 4,
          camp: false,
          n: sh.length,
        });
      }
    }
    if (I.parent !== null) {
      const P = M.island(I.parent);
      const la = M.landingOn(I, P.cx, P.cy);
      const lb = M.landingOn(P, I.cx, I.cy);
      if (I.link === "bridge") {
        roads.push({
          key: `br:${M.seed}:${I.id}`,
          pts: roadCurve(la, lb, `${M.seed}:br:${I.id}`, 0.08),
          kind: "link",
          R: 20,
        });
      } else {
        const a = M.coastOn(I, P.cx, P.cy);
        const b = M.coastOn(P, I.cx, I.cy);
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        const pa: Pt = [a[0] + u[0] * 150, a[1] + u[1] * 150];
        const pb: Pt = [b[0] - u[0] * 150, b[1] - u[1] * 150];
        roads.push(
          { key: `pa:${M.seed}:${I.id}`, pts: [la, a], kind: "trunk", R: 18 },
          { key: `pb:${M.seed}:${I.id}`, pts: [lb, b], kind: "trunk", R: 18 },
        );
        piers.push(
          {
            key: `pier:${M.seed}:${I.id}:a`,
            x: a[0] - u[0] * 20,
            y: a[1] - u[1] * 20,
            ang: Math.atan2(u[1], u[0]),
          },
          {
            key: `pier:${M.seed}:${I.id}:b`,
            x: b[0] + u[0] * 20,
            y: b[1] + u[1] * 20,
            ang: Math.atan2(-u[1], -u[0]),
          },
        );
        ferries.push({
          key: `fy:${M.seed}:${I.id}`,
          a: pa,
          b: pb,
          ph: (I.id * 0.37) % 1,
        });
      }
    }
  }
  // the campfire burns on the busiest home square
  const homeSquares = squares.filter(
    (q) => M.slotById.get(q.slot)!.island.home,
  );
  const camp = homeSquares.sort(
    (p, q) =>
      q.n - p.n || M.slotById.get(p.slot)!.k - M.slotById.get(q.slot)!.k,
  )[0];
  const finalSquares = squares.map((q) =>
    q === camp ? { ...q, camp: true } : q,
  );
  for (const s of active) {
    const shown = shownOf(s);
    const D = sitesOf(M, s.island).sites.get(s.id)!;
    // each street runs out of the square as far as its last plot
    D.streets.forEach((S, i) => {
      const far = Math.max(
        -1,
        ...shown.filter((p) => p.street === i).map((p) => p.arc ?? -1),
      );
      if (far < 0) return;
      const L = Math.min(S.arcs[S.arcs.length - 1]!, far + 30);
      roads.push({
        key: `st:${M.seed}:${s.id}:${i}:${Math.round(L)}`,
        pts: cutAt(S.pts, S.arcs, L),
        kind: "street",
        R: ROAD_R.street,
      });
    });
    for (const p of shown) {
      const key = `ln:${M.seed}:${p.id}`;
      laneOf.set(key, { plot: p, band: bands.length });
      bands.push(placed(p, p.g));
      roads.push({
        key,
        pts: p.lane,
        kind: arcsOf(p.lane).at(-1)! > 300 ? "lane" : "spur",
        R: ROAD_R.spur,
      });
      const appId = occupantOf.get(p.id);
      const app = appId ? byId.get(appId) : undefined;
      if (appId && app) {
        buildings.push({
          appId,
          plot: p,
          x: p.x,
          y: p.y,
          w: app.footprint.w,
          depth: app.footprint.depth,
          signX: p.sx,
          box: plotBox(p),
          door: [p.x, p.y + 18],
        });
      } else lots.push(p);
    }
  }
  const height = (x: number, y: number) => M.heightAt(x, y, islands);
  const built = wornRoads(
    chained(roads, (r) => laneOf.has(r.key), finalSquares),
    laneOf,
    bands,
    height,
    finalSquares,
  ).map((r): Road => ({
    ...r,
    ...roadSamples(r.pts, r.R, height, r.wear, r.head, r.tail),
  }));
  const bounds = islands.map((I) => I.bounds);
  const rect: Box = [
    Math.min(...bounds.map((b) => b[0])) - 300,
    Math.min(...bounds.map((b) => b[1])) - 300,
    Math.max(...bounds.map((b) => b[2])) + 300,
    Math.max(...bounds.map((b) => b[3])) + 300,
  ];
  return {
    islands,
    active,
    roads: built,
    squares: finalSquares,
    buildings,
    lots,
    ferries,
    piers,
    dock: islands[0]?.home ? M.homeDock() : null,
    rect,
  };
}

/** A stable small number per road key (for per-road variation in the renderer). */
export const roadHash = (key: string): number => fnv1a32(key) % 9973;
