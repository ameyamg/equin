// Placement: where each app's building stands. Append-only — an app keeps its
// plot, and a plot outlives its app as an empty lot, which a later app may take
// if its building fits there. Category first: a district holds ONE group (the
// app's leaf category tag; its kind is its first plot's group), so a new app
// goes into a district of its own group — on a lot that fits it or a new plot,
// the spot its setting likes best (a landmark that wants the coast takes its
// district's coast, never leaves its district for it). Only when no district
// of its group has room does it open one, never sharing another group's: next
// to its region's districts (the root tag) on an island already holding them,
// else — a new region — on the home island while it has a slot for each of
// its groups, else on a fresh island nearest its region, and only when no
// island is left on any free slot; of those, the slot that holds the most of
// its group still to come in this batch. Apps placed together take turns: the landmarks (a
// building that wants the coast, a hill…) first, the one with the fewest
// spots that suit it first, and each leaves alone the settings rarer than its
// own that a later one wants.
//
// `placeResidents(world, placement, residents)` is a pure function: it returns
// a new `Placement`, never touching the one it was given.

import {
  GROUND_BAND,
  type Box,
  type Footprint,
  type Setting,
} from "@plugins/apps/plugins/isle/plugins/buildings/core";
import { pointIndex, type Pt } from "./geometry";
import {
  bestSpot,
  groundOK,
  laneHits,
  placed,
  plotCtx,
  sitesOf,
  landWith,
  NO_SETTINGS,
  spotsFor,
  tagScore,
  type BestSpot,
  type PlotBoxes,
  type PlotCtx,
  type PlotSpot,
} from "./sites";
import type { Island, Slot, WorldModel } from "./world-model";

/** How many of a group's apps still to come a new district is tried with (a district holds about this many at most). */
const KIN_TRIAL = 12;

/** A plot as a trial placement lays it: its spot and boxes. */
type TrialPlot = PlotSpot & PlotBoxes;

/** The top of a plot's keep (door and sign), door-relative. */
const KEEP_TOP = -100;

/** The group (and region) of an app filed under no category: a kind of its own. */
export const NO_GROUP = "_";

/** An app as placement sees it: its group and region, and its building's declared footprint. */
export interface Resident {
  readonly id: string;
  /** Its category: the leaf tag id it is filed under ({@link NO_GROUP}: none). A district holds one group. */
  readonly group: string;
  /** Its category's root tag id ({@link NO_GROUP}: none): a region's districts open side by side. */
  readonly region: string;
  readonly footprint: Footprint;
  /** The spots its building likes, first choice first. */
  readonly setting: readonly Setting[];
  /** Its building's signpost x (`BuildingSpec.signX`); omitted: just past the base. */
  readonly signX?: number;
  /** Half its signpost board's width, px (see `signHalfWidth`). */
  readonly signHalf: number;
}

/** A plot: where a building stands, made for one app and kept forever. Plain JSON. */
export interface Plot extends PlotBoxes {
  /** `<slot id>:<n>` */
  readonly id: string;
  /** Its index among its district's plots. */
  readonly n: number;
  /** Its index among every plot of the world, in the order they were made. */
  readonly seq: number;
  /** Its district slot, `<island>.<k>`. */
  readonly slot: string;
  readonly x: number;
  readonly y: number;
  readonly lane: readonly Pt[];
  readonly ring: boolean;
  readonly street: number | null;
  readonly arc: number | null;
  readonly edge: number | null;
  readonly landing: number | null;
  readonly row: string | null;
  readonly tags: readonly Setting[];
  /** The land feature it was made on, or null for a row or a gap. */
  readonly feat: Setting | null;
  /**
   * The group of the app it was made for: a district takes the group of its
   * first plot. Kept as made — an app re-filed since stands in a district of
   * its old group until the world is tidied (`misplacedResidents`).
   */
  readonly group: string;
  /** The region of the app it was made for. */
  readonly region: string;
  /**
   * Given back to nature (`restoreLot`): an empty lot drawn as the land it was
   * made on — no fence, no stake, no lane — so the scenery grows back. It keeps
   * its place among its district's plots (ids are positional) and may still be
   * built on: a building landing on it clears this.
   */
  readonly wild: boolean;
  /**
   * Made over another plot — a move once set a building's new plot down on
   * the lot it left — and so struck out: it keeps its place among its
   * district's plots (ids are positional, plots never deleted) but is no land
   * at all: never drawn, never built on, never in anyone's way.
   */
  readonly retired: boolean;
}

/** The persisted state: every plot ever made, and who stands on which. */
export interface Placement {
  /** Each district's plots, in the order they were made. */
  readonly plots: Readonly<Record<string, readonly Plot[]>>;
  /** App id → plot id. */
  readonly occupant: Readonly<Record<string, string>>;
}

export const EMPTY_PLACEMENT: Placement = { plots: {}, occupant: {} };

/** The first plot of a district that is land (not retired), or null while it is unopened. */
const firstLand = (placement: Placement, slotId: string): Plot | null =>
  placement.plots[slotId]?.find((p) => !p.retired) ?? null;

/** A district's group: the one its first plot was made for (null while it is unopened). */
export function districtGroup(
  placement: Placement,
  slotId: string,
): string | null {
  return firstLand(placement, slotId)?.group ?? null;
}

/** A district's region: the one its first plot was made for (null while it is unopened). */
export function districtRegion(
  placement: Placement,
  slotId: string,
): string | null {
  return firstLand(placement, slotId)?.region ?? null;
}

/**
 * The residents standing in a district of another group (or region) than
 * their own — filed under another category since they were placed, their
 * category moved under another root, or moved there by hand: what tidying the
 * world (placing everyone afresh) would move.
 */
export function misplacedResidents(
  placement: Placement,
  residents: readonly Resident[],
): readonly string[] {
  return residents.flatMap((r) => {
    const p = plotById(placement, placement.occupant[r.id]);
    return p &&
      (districtGroup(placement, p.slot) !== r.group ||
        districtRegion(placement, p.slot) !== r.region)
      ? [r.id]
      : [];
  });
}

/** What a new district's choice knows of the apps still to place in this call. */
interface Opening {
  /** The new district's group and region. */
  readonly group: string;
  readonly region: string;
  /**
   * Each region's groups that have no district yet among the apps still to
   * place (this one's included): the districts they will open.
   */
  readonly unopened: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Where a district of `o.group` may open, as tiers tried in turn (the first
 * tier with a slot that has room wins). Free slots (no plot that is land)
 * only, every one on an island in play (`islandsInPlay`):
 * 1. on the islands already holding its region, nearest its own group's
 *    districts, then its region's — leaving the free slots the other regions
 *    of those islands still need for their unopened groups;
 * 2. a region with no district yet: the home island, when it has a free slot
 *    for each of the region's unopened groups beyond those the regions already
 *    there still need — so home fills first, a region kept whole;
 * 3. a fresh island (a child of a revealed one), nearest its region's
 *    districts (a new region: one with a slot for each of its unopened groups
 *    first, then the lowest id) — a region claims an island;
 * 4. any free slot of a revealed island, nearest first.
 */
function newDistrictTiers(
  M: WorldModel,
  placement: Placement,
  o: Opening,
): Slot[][] {
  const free = (s: Slot) => districtGroup(placement, s.id) === null;
  const revealed = new Set([0]);
  for (const s of M.slots)
    if ((placement.plots[s.id]?.length ?? 0) > 0) revealed.add(s.island.id);
  const regionOf = (s: Slot) => districtRegion(placement, s.id);
  const mine = M.slots.filter((s) => regionOf(s) === o.region);
  const kin = mine.filter((s) => districtGroup(placement, s.id) === o.group);
  const dist = (from: readonly Slot[]) => (s: Slot) =>
    from.reduce(
      (d, t) => Math.min(d, Math.hypot(s.x - t.x, s.y - t.y)),
      from.length ? Infinity : 0,
    );
  const nearKin = dist(kin);
  const nearMine = dist(mine);
  const need = (r: string) => o.unopened.get(r)?.size ?? 0;
  /** I's free slots, less those the other regions on it still need. */
  const room = (I: Island) => {
    const others = new Set<string>();
    for (const s of I.slots) {
      const r = regionOf(s);
      if (r !== null && r !== o.region) others.add(r);
    }
    let held = 0;
    for (const r of others) held += need(r);
    return I.slots.filter(free).length - held;
  };
  const homes = [...new Set(mine.map((s) => s.island))];
  const tiers: Slot[][] = [
    homes
      .filter((I) => room(I) > 0)
      .flatMap((I) => I.slots.filter(free))
      .sort(
        (a, b) =>
          nearKin(a) - nearKin(b) || nearMine(a) - nearMine(b) || a.k - b.k,
      ),
  ];
  const home = M.islands[0]!;
  if (!mine.length && room(home) >= need(o.region))
    tiers.push(home.slots.filter(free));
  const fresh = M.islands
    .filter(
      (I) => !revealed.has(I.id) && I.parent !== null && revealed.has(I.parent),
    )
    .map((I) => ({
      I,
      d: nearMine(I.slots[0]!),
      fits: I.slots.length >= need(o.region),
    }))
    .sort(
      (a, b) => a.d - b.d || Number(b.fits) - Number(a.fits) || a.I.id - b.I.id,
    );
  for (const { I } of fresh) tiers.push(I.slots.filter(free));
  tiers.push(
    M.slots
      .filter((s) => revealed.has(s.island.id) && free(s))
      .sort(
        (a, b) =>
          nearMine(a) - nearMine(b) || a.island.id - b.island.id || a.k - b.k,
      ),
  );
  return tiers.filter((t) => t.length);
}

/** A plot by id, or null. */
export function plotById(
  placement: Placement,
  id: string | undefined,
): Plot | null {
  if (!id) return null;
  const i = id.lastIndexOf(":");
  return placement.plots[id.slice(0, i)]?.[Number(id.slice(i + 1))] ?? null;
}

/**
 * Half a signpost board's width for an app name, px: the board fits the name
 * in 14 px Nunito ExtraBold (≈ 8.4 px a character) plus 44 px of margins and
 * glyph. An estimate — placement must not measure text — so the renderer fits
 * the name to this width rather than the other way round.
 */
export function signHalfWidth(name: string): number {
  return (name.length * 8.4 + 44) / 2 + 4;
}

/** The boxes a resident's building reserves, its sign on side ±1. */
export function plotBoxes(r: Resident, side: 1 | -1): PlotBoxes {
  const f = r.footprint;
  const sx = side * Math.abs(r.signX ?? f.w / 2 + 30);
  const h = r.signHalf;
  const lo = f.ground;
  const up = f.upper;
  const g: Box = [
    Math.min(lo[0], sx - h) - 4,
    -GROUND_BAND,
    Math.max(lo[2], sx + h) + 4,
    Math.max(lo[3], 18) + 4,
  ];
  const u: Box = up
    ? [up[0] - 2, up[1] - 2, up[2] + 2, -GROUND_BAND]
    : [-12, -GROUND_BAND - 12, 12, -GROUND_BAND];
  return {
    g,
    u,
    k: [Math.min(-40, sx - h), KEEP_TOP, Math.max(40, sx + h), g[3]],
    sx,
    side,
  };
}

const inside = (a: Box, b: Box) =>
  a[0] >= b[0] - 0.5 &&
  a[1] >= b[1] - 0.5 &&
  a[2] <= b[2] + 0.5 &&
  a[3] <= b[3] + 0.5;

/** The settings a building asks for that only some spots have (not a square or a lane). */
const landmark = (a: Resident): Setting[] =>
  a.setting.filter((t) => t !== "square" && t !== "lane");

type MutPlot = { -readonly [K in keyof Plot]: Plot[K] };

/**
 * The islands drawing `placement`, or placing the next app on it, can read: the
 * revealed ones (home, every island holding a plot, and the islands they were
 * grown from) and the ones a new district may open on (each child of a revealed
 * island). Their shapes are what to have built ahead (in a bake worker) — any
 * other is built when first read.
 */
export function islandsInPlay(
  M: WorldModel,
  placement: Placement,
): readonly Island[] {
  const revealed = new Set([0]);
  for (const s of M.slots)
    if ((placement.plots[s.id]?.length ?? 0) > 0)
      for (let I: Island | null = s.island; I;)
        if (revealed.has(I.id)) I = null;
        else {
          revealed.add(I.id);
          I = I.parent !== null ? M.island(I.parent) : null;
        }
  return M.islands.filter(
    (I) => revealed.has(I.id) || (I.parent !== null && revealed.has(I.parent)),
  );
}

/** Places every resident that has no plot yet. Pure: returns a new placement. */
export function placeResidents(
  M: WorldModel,
  placement: Placement,
  residents: readonly Resident[],
): Placement {
  const plots: Record<string, MutPlot[]> = {};
  for (const [k, list] of Object.entries(placement.plots))
    plots[k] = list.map((p) => ({ ...p }));
  const occupant: Record<string, string> = { ...placement.occupant };
  const state = (): Placement => ({ plots, occupant });
  // a retired plot is no land: neither a lot to take nor in anyone's way
  const plotsOf = (s: Slot): MutPlot[] =>
    (plots[s.id] ?? []).filter((p) => !p.retired);
  const islandPlots = (I: Island) => I.slots.flatMap(plotsOf);
  const opened = (s: Slot) => (plots[s.id]?.length ?? 0) > 0;

  const boxCache = new Map<string, PlotBoxes>();
  const boxesFor = (a: Resident, side: 1 | -1) => {
    const key = `${a.id}:${side}`;
    let B = boxCache.get(key);
    if (!B) boxCache.set(key, (B = plotBoxes(a, side)));
    return B;
  };
  const holds = (p: Plot, B: PlotBoxes) =>
    inside(B.g, p.g) && inside(B.u, p.u) && inside(B.k, p.k);
  // can app stand on an existing plot (a lot)? → its boxes there, or null
  const canTake = (p: MutPlot, a: Resident): PlotBoxes | null => {
    const s = M.slotById.get(p.slot);
    if (!s)
      throw new Error(
        `isle placement: plot ${p.id} names unknown slot ${p.slot}`,
      );
    const Sx = sitesOf(M, s.island);
    const others = islandPlots(s.island).filter((q) => q !== p);
    // (with its own lane given, groundOK checks each plot's lane, not the index)
    const ctx = { plots: others, laneIdx: pointIndex() };
    for (const side of [p.side, -p.side as 1 | -1]) {
      const B = boxesFor(a, side);
      if (holds(p, B)) return B;
      const q = { ...p, g: B.g, u: B.u, k: B.k };
      if (
        groundOK(M, Sx, s, q, ctx, null, p.lane) === true &&
        !laneHits(p.lane.slice(2), placed(q, q.g), 2)
      )
        return B;
    }
    return null;
  };

  const taken = new Map<string, string>();
  for (const a of residents) {
    const p = plotById(state(), occupant[a.id]);
    if (p && !p.retired && !taken.has(p.id)) taken.set(p.id, a.id);
    else delete occupant[a.id];
  }
  // in one batch, the landmarks that want a particular spot (the coast, a
  // hill…) choose first, the one with the fewest spots it suits first — a
  // scarce setting, or a building hard to fit there — then the biggest
  const inView = M.islands.filter(
    (I) => I.id === 0 || I.slots.some((s) => opened(s)),
  );
  const spots = (a: Resident) =>
    inView.reduce(
      (n, I) =>
        n + spotsFor(M, I, [boxesFor(a, 1), boxesFor(a, -1)], landmark(a)),
      0,
    );
  const land = (want: readonly Setting[]) =>
    inView.reduce((n, I) => n + landWith(M, I, want), 0);
  const area = (a: Resident) => {
    const B = boxesFor(a, 1);
    return (B.u[2] - B.u[0]) * (B.u[3] - B.u[1]);
  };
  const pending = residents.filter((a) => !occupant[a.id]);
  // (alone, a landmark has no one to choose before: its spots need no counting)
  const ranked = pending.filter((a) => landmark(a).length).length > 1;
  const todo = pending
    .map((a, i) => ({
      a,
      i,
      n: !landmark(a).length ? Infinity : ranked ? spots(a) : 0,
    }))
    .sort(
      (p, q) =>
        (p.n === q.n ? 0 : p.n < q.n ? -1 : 1) ||
        (p.n === Infinity ? 0 : area(q.a) - area(p.a)) ||
        p.i - q.i,
    )
    .map((o) => o.a);
  // what each landmark leaves to the ones after it: the settings they want
  // that are rarer on the land than its own
  const spareAfter = todo.map((a, k) => {
    const own = landmark(a);
    if (!own.length || !ranked) return NO_SETTINGS;
    const mine = land(own);
    const spare = new Set<Setting>();
    for (const b of todo.slice(k + 1))
      for (const t of landmark(b))
        if (!own.includes(t) && land([t]) < mine) spare.add(t);
    return spare;
  });
  const ctxs = new Map<number, PlotCtx<MutPlot>>();
  const ctxOf = (I: Island) => {
    let c = ctxs.get(I.id);
    if (!c) ctxs.set(I.id, (c = plotCtx(islandPlots(I))));
    return c;
  };
  // per call: the biggest building a district had no room for
  const full = new Map<string, { gw: number; uw: number; uh: number }>();

  const groupOf = (s: Slot) => districtGroup(state(), s.id);
  /**
   * How many of `kin` (one group's apps, in the order they are placed) a new
   * district at `s` would hold: each placed in turn on a trial copy of its
   * island's plots, as the real ones will be.
   */
  const kinHeld = (s: Slot, kin: readonly Resident[]): number => {
    const Sx = sitesOf(M, s.island);
    const site = Sx.sites.get(s.id)!;
    const trial = plotCtx<TrialPlot>([...ctxOf(s.island).plots]);
    let n = 0;
    for (const b of kin) {
      const sp = bestSpot(
        M,
        Sx,
        site,
        trial,
        (side) => boxesFor(b, side),
        b.setting,
      );
      if (!sp) continue;
      n++;
      trial.plots.push({ ...sp.spot, ...boxesFor(b, sp.side) });
      trial.laneIdx.addLine(
        sp.spot.ring ? sp.spot.lane.slice(0, -1) : sp.spot.lane,
        6,
      );
    }
    return n;
  };
  /** A slot's place in the order districts opened (its first plot's seq). */
  const openedAt = (s: Slot) => plots[s.id]?.[0]?.seq ?? Infinity;

  for (const [k, a] of todo.entries()) {
    const spare = spareAfter[k]!;
    const pref = a.setting;
    let best:
      | { sc: number; p: MutPlot; B: PlotBoxes }
      | { sc: number; s: Slot; sp: BestSpot }
      | null = null;
    const B0 = boxesFor(a, 1);
    const gw = B0.g[2] - B0.g[0];
    const uw = B0.u[2] - B0.u[0];
    const uh = B0.u[3] - B0.u[1];
    /** `a`'s best new spot in district `s` scored `base` + how it suits, or null when none beats `floor`. */
    const spotIn = (
      s: Slot,
      base: number,
      floor: number,
    ): { sc: number; s: Slot; sp: BestSpot } | null => {
      const F = full.get(s.id);
      if (F && gw >= F.gw && uw >= F.uw && uh >= F.uh) return null;
      if (base + 10 <= floor) return null;
      const Sx = sitesOf(M, s.island);
      const sp = bestSpot(
        M,
        Sx,
        Sx.sites.get(s.id)!,
        ctxOf(s.island),
        (side) => boxesFor(a, side),
        pref,
        spare,
      );
      if (!sp && (!F || (gw <= F.gw && uw <= F.uw && uh <= F.uh)))
        full.set(s.id, { gw, uw, uh });
      return sp && base + sp.score > floor
        ? { sc: base + sp.score, s, sp }
        : null;
    };

    // 1. a district of its own group: a lot it fits, or a new spot — the
    // setting picks, the first-opened district breaking near-ties
    const own = M.slots
      .filter((s) => groupOf(s) === a.group)
      .sort((s, t) => openedAt(s) - openedAt(t));
    for (const [i, s] of own.entries()) {
      const base = -i * 0.5;
      for (const p of plotsOf(s)) {
        if (taken.has(p.id)) continue;
        // a lot is preferred to a new plot — but not one given back to nature
        const sc = base + tagScore(pref, p.tags, spare) + (p.wild ? 0 : 1);
        if (best && sc <= best.sc) continue;
        const B = canTake(p, a);
        if (B) best = { sc, p, B };
      }
      best = spotIn(s, base, best?.sc ?? -Infinity) ?? best;
    }

    // 2. none has room (or there is none yet): it opens a district of its
    // own — never sharing another group's — in the first tier with room: on
    // the slot that holds the most of its group still to come in this call
    // (all of them, or as many as any slot holds), the setting breaking ties
    if (!best) {
      const later = todo.slice(k);
      const kin = later.filter((b) => b.group === a.group).slice(0, KIN_TRIAL);
      const openGroups = new Set(M.slots.map(groupOf));
      const unopened = new Map<string, Set<string>>();
      for (const b of later)
        if (!openGroups.has(b.group)) {
          const g = unopened.get(b.region) ?? new Set<string>();
          unopened.set(b.region, g.add(b.group));
        }
      const opening = { group: a.group, region: a.region, unopened };
      for (const tier of newDistrictTiers(M, state(), opening)) {
        let top: {
          c: NonNullable<ReturnType<typeof spotIn>>;
          n: number;
        } | null = null;
        for (const [i, s] of tier.entries()) {
          const c = spotIn(s, -i * 0.4, -Infinity);
          if (!c) continue;
          const n = kin.length > 1 ? kinHeld(s, kin) : 1;
          if (!top || n > top.n || (n === top.n && c.sc > top.c.sc))
            top = { c, n };
        }
        if (top) {
          best = top.c;
          break;
        }
      }
    }
    if (!best) continue; // the archipelago is full
    let p: MutPlot;
    if ("p" in best) {
      p = best.p;
      Object.assign(p, {
        g: best.B.g,
        u: best.B.u,
        k: best.B.k,
        sx: best.B.sx,
        side: best.B.side,
        wild: false,
      });
    } else {
      const { s, sp } = best;
      const B = boxesFor(a, sp.side);
      const L = (plots[s.id] ??= []);
      p = {
        id: `${s.id}:${L.length}`,
        n: L.length,
        seq: Object.values(plots).reduce((t, l) => t + l.length, 0),
        slot: s.id,
        x: sp.spot.x,
        y: sp.spot.y,
        g: B.g,
        u: B.u,
        k: B.k,
        sx: B.sx,
        side: B.side,
        lane: sp.spot.lane,
        ring: sp.spot.ring,
        street: sp.spot.street,
        arc: sp.spot.arc,
        edge: sp.spot.edge,
        landing: sp.spot.landing,
        row: sp.spot.row,
        tags: sp.tags,
        feat: sp.c.feat,
        group: a.group,
        region: a.region,
        wild: false,
        retired: false,
      };
      L.push(p);
      const ctx = ctxOf(s.island);
      ctx.plots.push(p);
      ctx.laneIdx.addLine(p.ring ? p.lane.slice(0, -1) : p.lane, 6);
    }
    occupant[a.id] = p.id;
    taken.set(p.id, a.id);
  }
  return state();
}
