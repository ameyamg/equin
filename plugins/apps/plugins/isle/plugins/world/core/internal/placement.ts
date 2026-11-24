// Placement: where each app's building stands. Append-only — an app keeps its
// plot, and a plot outlives its app as an empty lot, which a later app may take
// if its building fits there. Grouped by category: a district holds the apps of
// ONE region (the root of their category tag; its kind is its first plot's), so
// a new app goes into a district of its own region — the spot its setting likes
// best, then the emptier district — on a lot that fits it or a new plot made
// for it. A region opens a district when it has none, and another only when no
// spot of its own fits; a new island only when the revealed sites are all
// taken (the home island holds five districts). Apps placed together go one
// region at a time, the biggest first; inside one, they take turns: the landmarks (a building that wants the coast, a
// hill…) first, the one with the fewest spots that suit it first, and each
// leaves alone the settings rarer than its own that a later one wants.
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

/** How many of a region's apps still to come a new district is tried with (a district holds about this many at most). */
const KIN_TRIAL = 12;

/** What one app still to come in this call is worth when choosing where its region's district opens: more than any setting. */
const KIN_HELD = 12;

/** A plot as a trial placement lays it: its spot and boxes. */
type TrialPlot = PlotSpot & PlotBoxes;

/** The top of a plot's keep (door and sign), door-relative. */
const KEEP_TOP = -100;

/** The group (and region) of an app filed under no category: a kind of its own. */
export const NO_GROUP = "_";

/** An app as placement sees it: its category and its building's declared footprint. */
export interface Resident {
  readonly id: string;
  /** Its category: the leaf tag id it is filed under ({@link NO_GROUP}: none). */
  readonly group: string;
  /** Its category's root tag id ({@link NO_GROUP}: none): a district holds one region's apps. */
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
  /** The group of the app it was made for. */
  readonly group: string;
  /** The region of the app it was made for: a district takes the kind of its first plot. */
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

/** A district's kind: the region its first plot was made for (null while it is unopened). */
export function districtRegion(
  placement: Placement,
  slotId: string,
): string | null {
  return placement.plots[slotId]?.[0]?.region ?? null;
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
  // one region at a time, the biggest first — so each opens its district
  // against the land as it will stay, and a big region gets a big district;
  // inside a region, the landmarks first
  const regionSize = new Map<string, number>();
  const regionAt = new Map<string, number>();
  for (const a of pending) {
    regionSize.set(a.region, (regionSize.get(a.region) ?? 0) + 1);
    if (!regionAt.has(a.region)) regionAt.set(a.region, regionAt.size);
  }
  const todo = pending
    .map((a, i) => ({
      a,
      i,
      size: regionSize.get(a.region)!,
      at: regionAt.get(a.region)!,
      n: !landmark(a).length ? Infinity : ranked ? spots(a) : 0,
    }))
    .sort(
      (p, q) =>
        q.size - p.size ||
        p.at - q.at ||
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

  /**
   * How many of `kin` (one region's apps, by their index in `todo`) a new
   * district at `s` would hold: each placed in turn on a trial copy of its
   * island's plots, as the real ones will be.
   */
  const kinHeld = (s: Slot, kin: readonly number[]): number => {
    const Sx = sitesOf(M, s.island);
    const site = Sx.sites.get(s.id)!;
    const trial = plotCtx<TrialPlot>([...ctxOf(s.island).plots]);
    let n = 0;
    for (const j of kin) {
      const b = todo[j]!;
      const sp = bestSpot(
        M,
        Sx,
        site,
        trial,
        (side) => boxesFor(b, side),
        b.setting,
        spareAfter[j],
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

  for (const [k, a] of todo.entries()) {
    const spare = spareAfter[k]!;
    // its region's apps still to come (itself first): a district it opens
    // goes where the most of them fit
    const kin = todo
      .flatMap((b, j) => (j >= k && b.region === a.region ? [j] : []))
      .slice(0, KIN_TRIAL);
    const count = new Map<string, number>();
    for (const [pid] of taken) {
      const q = plotById(state(), pid)!;
      count.set(q.slot, (count.get(q.slot) ?? 0) + 1);
    }
    // its category's districts: the only open ones it may join
    const own = (s: Slot) => districtRegion(state(), s.id) === a.region;
    const revealed = new Set([0]);
    for (const s of M.slots) if (opened(s)) revealed.add(s.island.id);
    const next = M.islands.find(
      (I) =>
        I.slots.some((s) => !opened(s)) &&
        (revealed.has(I.id) || (I.parent !== null && revealed.has(I.parent))),
    );
    // a category with no district opens one; one with a district opens
    // another only when no spot of its own fits
    const openCost = M.slots.some((s) => opened(s) && own(s)) ? 30 : 0;
    const pref = a.setting;
    let best:
      | { sc: number; p: MutPlot; B: PlotBoxes }
      | { sc: number; s: Slot; sp: BestSpot }
      | null = null;
    const B0 = boxesFor(a, 1);
    const gw = B0.g[2] - B0.g[0];
    const uw = B0.u[2] - B0.u[0];
    const uh = B0.u[3] - B0.u[1];
    // first the revealed islands' districts (home fills first); when nothing
    // of them takes it — its region's last free slot there too cramped for
    // it — a fresh island
    for (const spill of [false, true]) {
      const opts: { s: Slot; base: number }[] = [];
      M.slots.forEach((s, si) => {
        const open = opened(s);
        if (open && !own(s)) return;
        if (
          !open &&
          !revealed.has(s.island.id) &&
          (spill
            ? s.island.parent === null || !revealed.has(s.island.parent)
            : s.island !== next)
        )
          return;
        const newIsl = !revealed.has(s.island.id) ? 8 : 0;
        if (
          !spill &&
          !open &&
          newIsl === 0 &&
          M.slots.some(
            (t) =>
              t.island.id < s.island.id &&
              revealed.has(t.island.id) &&
              !opened(t),
          )
        )
          return;
        const n = count.get(s.id) ?? 0;
        opts.push({
          s,
          base:
            (open ? (n < 5 ? (5 - n) * 0.4 : -(n - 5) * 1.3) : 0) -
            (open ? 0 : openCost) -
            newIsl -
            (open ? 0 : (si - M.slots.indexOf(s.island.slots[0]!)) * 0.4) +
            // its region's first district: where the most of it fits (an
            // overflow district only opens when nothing of its own fits, so its
            // setting decides)
            (!open && openCost === 0 && kin.length > 1
              ? kinHeld(s, kin) * KIN_HELD
              : 0),
        });
      });
      opts.sort((p, q) => q.base - p.base);
      for (const { s, base } of opts) {
        if (best && base + 11 <= best.sc) break;
        for (const p of plotsOf(s)) {
          if (taken.has(p.id)) continue;
          // a lot is preferred to a new plot — but not one given back to nature
          const sc = base + tagScore(pref, p.tags, spare) + (p.wild ? 0 : 1);
          if (best && sc <= best.sc) continue;
          const B = canTake(p, a);
          if (B) best = { sc, p, B };
        }
        const Sx = sitesOf(M, s.island);
        const site = Sx.sites.get(s.id)!;
        const ctx = ctxOf(s.island);
        const F = full.get(s.id);
        if (F && gw >= F.gw && uw >= F.uw && uh >= F.uh) continue;
        if (best && base + 10 <= best.sc) continue;
        const sp = bestSpot(
          M,
          Sx,
          site,
          ctx,
          (side) => boxesFor(a, side),
          pref,
          spare,
        );
        if (!sp && (!F || (gw <= F.gw && uw <= F.uw && uh <= F.uh)))
          full.set(s.id, { gw, uw, uh });
        if (sp && (!best || base + sp.score > best.sc))
          best = { sc: base + sp.score, s, sp };
      }
      if (best) break;
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
