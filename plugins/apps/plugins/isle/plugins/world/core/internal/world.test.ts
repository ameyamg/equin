import { describe, expect, test } from "bun:test";
import type { Setting } from "@plugins/apps/plugins/isle/plugins/buildings/core";
import { fnv1a32 } from "@plugins/packages/plugins/string-hash/core";
import { layoutWorld } from "./layout";
import { applyMove, moveTargets, newPlotAt, restoreLot } from "./move";
import {
  districtGroup,
  districtRegion,
  EMPTY_PLACEMENT,
  islandsInPlay,
  misplacedResidents,
  placeResidents,
  plotById,
  signHalfWidth,
  type Placement,
  type Resident,
} from "./placement";
import { plotsClash } from "./sites";
import { findPath, walkable, walkGrid } from "./walk";
import { WorldModel } from "./world-model";

/**
 * A fixed fake category tree: each group is a path `<region>/<leaf>` (or a
 * root alone), with the setting its buildings like — 8 groups in 4 regions.
 */
const GROUPS: readonly (readonly [string, readonly Setting[]])[] = [
  ["work/forge", ["lane"]],
  ["art/music", ["square"]],
  ["data", ["shore", "harbour"]],
  ["sys", ["hill"]],
  ["work/office", ["square"]],
  ["art/paint", ["forest"]],
  ["art/games", ["lane", "square"]],
  ["sys/launch", ["square"]],
];
const regionOf = (group: string) => group.split("/")[0]!;

/** A made-up app with a building of a size seeded from its id (no painting needed). */
function fakeResident(i: number): Resident {
  const id = `x-app-${i}`;
  const h = fnv1a32(id);
  const [group, setting] = GROUPS[i % GROUPS.length]!;
  const half = [60, 75, 100, 85, 110][h % 5]!;
  const top = -(150 + (h % 140));
  return {
    id,
    group,
    region: regionOf(group),
    footprint: {
      w: half * 1.6,
      depth: 60,
      ground: [-half - 30, -112, half + 40, 46],
      upper: [-half, top, half, -112],
    },
    setting,
    signHalf: signHalfWidth(`App ${i}`),
  };
}

const residents = (n: number) =>
  Array.from({ length: n }, (_, i) => fakeResident(i));

function placedPlots(P: Placement, rs: readonly Resident[]) {
  return rs.map((r) => {
    const p = plotById(P, P.occupant[r.id]);
    if (!p) throw new Error(`${r.id} has no plot`);
    return p;
  });
}

function expectNoOverlap(P: Placement, rs: readonly Resident[]) {
  const plots = placedPlots(P, rs);
  for (let i = 0; i < plots.length; i++) {
    for (let j = i + 1; j < plots.length; j++) {
      const a = plots[i]!;
      const b = plots[j]!;
      if (plotsClash(a, b))
        throw new Error(`plots ${a.id} and ${b.id} overlap`);
    }
  }
}

describe("isle world", () => {
  test("the same seed and apps give a deep-equal world", () => {
    const rs = residents(14);
    const a = placeResidents(new WorldModel(7), EMPTY_PLACEMENT, rs);
    const b = placeResidents(new WorldModel(7), EMPTY_PLACEMENT, rs);
    expect(a).toEqual(b);
    const Ma = new WorldModel(7);
    const Mb = new WorldModel(7);
    expect(
      Ma.islands.map((I) => [I.id, I.cx, I.cy, I.parent, I.link, I.plan.kind]),
    ).toEqual(
      Mb.islands.map((I) => [I.id, I.cx, I.cy, I.parent, I.link, I.plan.kind]),
    );
    expect(Ma.slots.map((s) => [s.id, s.x, s.y])).toEqual(
      Mb.slots.map((s) => [s.id, s.x, s.y]),
    );
    // and a different seed gives a different archipelago
    expect(new WorldModel(8).islands.map((I) => I.cx)).not.toEqual(
      Ma.islands.map((I) => I.cx),
    );
  });

  test("placement does not mutate its input and keeps placed apps", () => {
    const M = new WorldModel(3);
    const first = placeResidents(M, EMPTY_PLACEMENT, residents(5));
    const snapshot = structuredClone(first);
    const again = placeResidents(M, first, residents(5));
    expect(first).toEqual(snapshot);
    expect(again).toEqual(first);
  });

  test("adding an app never moves an existing plot: 40 → 41", () => {
    const M = new WorldModel(1);
    const P40 = placeResidents(M, EMPTY_PLACEMENT, residents(40));
    const P41 = placeResidents(M, P40, residents(41));
    for (const r of residents(40)) {
      expect(P41.occupant[r.id]).toBe(P40.occupant[r.id]!);
      expect(plotById(P41, P41.occupant[r.id])).toEqual(
        plotById(P40, P40.occupant[r.id])!,
      );
    }
    expect(plotById(P41, P41.occupant["x-app-40"])).not.toBeNull();
  }, 120_000);

  test("adding apps one by one, 14 → 142, never moves a plot and never overlaps", () => {
    const M = new WorldModel(1);
    let P = placeResidents(M, EMPTY_PLACEMENT, residents(14));
    expectNoOverlap(P, residents(14));
    for (let n = 15; n <= 142; n++) {
      const before = P;
      P = placeResidents(M, before, residents(n));
      for (const r of residents(n - 1)) {
        expect(plotById(P, P.occupant[r.id])).toEqual(
          plotById(before, before.occupant[r.id])!,
        );
      }
      if (n === 40 || n === 142) expectNoOverlap(P, residents(n));
    }
    // more than one island by then
    const islands = new Set(
      Object.keys(P.plots).map((slot) => slot.split(".")[0]),
    );
    expect(islands.size).toBeGreaterThan(1);
  }, 600_000);

  test("no overlapping footprints at 40 and 142 apps placed at once", () => {
    for (const n of [40, 142]) {
      const rs = residents(n);
      const P = placeResidents(new WorldModel(2), EMPTY_PLACEMENT, rs);
      expectNoOverlap(P, rs);
    }
  }, 600_000);

  test("a removed app leaves a lot, and the lot is never lost", () => {
    const M = new WorldModel(4);
    const rs = residents(12);
    const P = placeResidents(M, EMPTY_PLACEMENT, rs);
    const without = rs.filter((r) => r.id !== "x-app-3");
    const layout = layoutWorld(M, P, without);
    expect(layout.lots.map((p) => p.id)).toEqual([P.occupant["x-app-3"]!]);
    expect(layout.buildings).toHaveLength(11);
  }, 120_000);

  test("an A* path stays on walkable land", () => {
    const M = new WorldModel(5);
    const rs = residents(24);
    const P = placeResidents(M, EMPTY_PLACEMENT, rs);
    const layout = layoutWorld(M, P, rs);
    const G = walkGrid(M, layout);
    const doors = layout.buildings.map((b) => b.door);
    let walked = 0;
    for (let i = 0; i + 1 < doors.length; i += 3) {
      const [a, b] = [doors[i]!, doors[i + 1]!];
      const path = findPath(G, a[0], a[1], b[0], b[1]);
      if (!path) continue;
      walked++;
      // every leg, sampled every 4 px, stays on walkable cells
      for (let k = 1; k < path.length; k++) {
        const [x0, y0] = path[k - 1]!;
        const [x1, y1] = path[k]!;
        const L = Math.hypot(x1 - x0, y1 - y0);
        for (let t = 0; t <= L; t += 4) {
          const x = x0 + ((x1 - x0) * t) / (L || 1);
          const y = y0 + ((y1 - y0) * t) / (L || 1);
          // walkable = land, or a bridge's planks over water
          if (!walkable(G, x, y))
            throw new Error(
              `path ${i} leaves the land at (${x.toFixed(0)}, ${y.toFixed(0)}) leg ${k}/${path.length - 1} ${JSON.stringify(path[k - 1])}→${JSON.stringify(path[k])} t=${t.toFixed(0)}/${L.toFixed(0)}`,
            );
        }
      }
    }
    expect(walked).toBeGreaterThan(3);
  }, 120_000);
});

describe("category-first placement", () => {
  const M = new WorldModel(1);
  const P142 = placeResidents(M, EMPTY_PLACEMENT, residents(142));
  const one = (() => {
    let P = placeResidents(M, EMPTY_PLACEMENT, residents(14));
    for (let n = 15; n <= 60; n++) P = placeResidents(M, P, residents(n));
    return P;
  })();
  const cases = [
    ["142 at once", P142, residents(142)],
    ["14 → 60 one by one", one, residents(60)],
  ] as const;

  for (const [name, P, rs] of cases) {
    test(`every open district holds exactly one group: ${name}`, () => {
      for (const [slot, list] of Object.entries(P.plots)) {
        const groups = new Set(
          list.filter((p) => !p.retired).map((p) => p.group),
        );
        expect([slot, groups.size]).toEqual([slot, 1]);
      }
      // and every app stands in a district of its own group
      expect(misplacedResidents(P, rs)).toEqual([]);
    });

    test(`a region's districts stay on one island while it has room: ${name}`, () => {
      const free = (I: number) =>
        M.island(I).slots.some((s) => districtGroup(P, s.id) === null);
      const regions = new Map<string, Map<number, number>>();
      for (const s of M.slots) {
        const r = districtRegion(P, s.id);
        if (r === null) continue;
        const first = P.plots[s.id]![0]!.seq;
        const m = regions.get(r) ?? new Map<number, number>();
        regions.set(r, m);
        m.set(s.island.id, Math.min(m.get(s.island.id) ?? first, first));
      }
      for (const [r, islands] of regions) {
        // in the order the region reached them, every island but the last is full
        const order = [...islands].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
        for (const I of order.slice(0, -1))
          expect([r, I, free(I)]).toEqual([r, I, false]);
      }
    });
  }

  test("142 apps spill onto more than one island", () => {
    const islands = new Set(
      Object.keys(P142.plots).map((slot) => slot.split(".")[0]),
    );
    expect(islands.size).toBeGreaterThan(1);
  });

  test("an app filed under another group is misplaced until placed afresh", () => {
    const rs = residents(24);
    const P = placeResidents(M, EMPTY_PLACEMENT, rs);
    const moved = rs.map((r, i) =>
      i === 0 ? { ...r, group: "data", region: "data" } : r,
    );
    expect(misplacedResidents(P, moved)).toEqual([rs[0]!.id]);
    // append-only: placing again keeps it where it stands…
    expect(placeResidents(M, P, moved)).toEqual(P);
    // …tidying (a fresh placement) files it with its new group
    expect(
      misplacedResidents(placeResidents(M, EMPTY_PLACEMENT, moved), moved),
    ).toEqual([]);
  });
});

describe("islands in play", () => {
  test("cover what the layout shows and where the next apps land", () => {
    const M = new WorldModel(1);
    let P = EMPTY_PLACEMENT;
    for (const n of [14, 40, 80]) {
      const inPlay = new Set(islandsInPlay(M, P).map((I) => I.id));
      const next = placeResidents(M, P, residents(n));
      for (const plot of placedPlots(next, residents(n)))
        expect(inPlay.has(M.slotById.get(plot.slot)!.island.id)).toBe(true);
      P = next;
      const shown = layoutWorld(M, P, residents(n)).islands.map((I) => I.id);
      const now = new Set(islandsInPlay(M, P).map((I) => I.id));
      for (const id of shown) expect(now.has(id)).toBe(true);
    }
  }, 120_000);
});

describe("restoring a lot", () => {
  const M = new WorldModel(7);
  const rs = residents(12);
  const P = placeResidents(M, EMPTY_PLACEMENT, rs);
  const gone = rs[3]!;
  const present = rs.filter((r) => r !== gone);
  const lotId = P.occupant[gone.id]!;

  test("a restored lot is no longer drawn, nor its lane, and its absent app lets go", () => {
    expect(layoutWorld(M, P, present).lots.map((p) => p.id)).toContain(lotId);
    const R = restoreLot(P, present, lotId);
    expect(plotById(R, lotId)!.wild).toBe(true);
    expect(R.occupant[gone.id]).toBeUndefined();
    const L = layoutWorld(M, R, present);
    expect(L.lots.map((p) => p.id)).not.toContain(lotId);
    expect(L.roads.some((r) => r.key.endsWith(`:${lotId}`))).toBe(false);
    // every other plot keeps its place
    for (const r of present) expect(R.occupant[r.id]).toBe(P.occupant[r.id]);
  });

  test("an occupied plot cannot be restored", () => {
    expect(() => restoreLot(P, rs, lotId)).toThrow(/stands on/);
  });

  test("a building landing on a restored lot clears it", () => {
    const R = restoreLot(P, present, lotId);
    const mover = present[0]!;
    const t = moveTargets(M, R, present, mover.id).find(
      (x) => x.kind === "plot" && x.plot.id === lotId,
    );
    if (!t) return; // the mover does not fit there
    const N = applyMove(M, R, present, mover.id, t);
    expect(plotById(N, lotId)!.wild).toBe(false);
    expect(
      layoutWorld(M, N, present).buildings.some((b) => b.plot.id === lotId),
    ).toBe(true);
  });
});

describe("moving a building", () => {
  const M = new WorldModel(7);
  const rs = residents(24);
  const P = placeResidents(M, EMPTY_PLACEMENT, rs);
  const fromOf = (id: string) => plotById(P, P.occupant[id])!;
  const home = M.islands[0]!;
  /** Dry points of the home island, on a coarse grid. */
  const homeGrid = (): [number, number][] => {
    const out: [number, number][] = [];
    for (let y = home.cy - 1600; y <= home.cy + 1600; y += 100)
      for (let x = home.cx - 2000; x <= home.cx + 2000; x += 100)
        if (M.height(home, x, y) > 0.25) out.push([x, y]);
    return out;
  };
  /** New plots for app `id` dropped over the home island's grid. */
  const drops = (id: string) =>
    homeGrid().flatMap((p) => newPlotAt(M, P, rs, id, p[0], p[1]) ?? []);

  test("a drop over its own spot reuses its plot: no new plot, no write", () => {
    for (const r of rs) {
      const from = fromOf(r.id);
      const T = moveTargets(M, P, rs, r.id);
      // the target a drop right where it stood picks (the nearest one)
      const near = T.reduce((a, b) =>
        Math.hypot(b.plot.x - from.x, b.plot.y - from.y) <
        Math.hypot(a.plot.x - from.x, a.plot.y - from.y)
          ? b
          : a,
      );
      expect(near.kind).toBe("stay");
      expect(near.plot.id).toBe(from.id);
      expect(applyMove(M, P, rs, r.id, near)).toBe(P);
    }
  });

  test("no target it takes alone overlaps the plot it leaves", () => {
    let nextDoor = 0;
    for (const [i, r] of rs.entries()) {
      const from = fromOf(r.id);
      for (const t of [
        ...moveTargets(M, P, rs, r.id),
        ...(i < 3 ? drops(r.id) : []),
      ]) {
        if (t.kind === "stay" || (t.kind === "plot" && t.other)) continue;
        if (t.plot.slot === from.slot) nextDoor++;
        const N = applyMove(M, P, rs, r.id, t);
        const landed = plotById(N, N.occupant[r.id])!;
        expect(landed.id).not.toBe(from.id);
        expect(plotsClash(landed, from)).toBe(false);
      }
    }
    // the case that made duplicates: a new plot in the district it leaves
    expect(nextDoor).toBeGreaterThan(0);
  });

  test("a drop far away makes a new plot there, and leaves its own as a lot", () => {
    const r = rs[0]!;
    const from = fromOf(r.id);
    const far = drops(r.id).sort(
      (a, b) =>
        Math.hypot(b.plot.x - from.x, b.plot.y - from.y) -
        Math.hypot(a.plot.x - from.x, a.plot.y - from.y),
    )[0]!;
    expect(far).toBeDefined();
    const N = applyMove(M, P, rs, r.id, far);
    expect(N.occupant[r.id]).toBe(far.plot.id);
    expect(far.plot.n).toBe(P.plots[far.plot.slot]?.length ?? 0);
    expect(layoutWorld(M, N, rs).lots.map((p) => p.id)).toContain(from.id);
  });

  test("a building can be dropped anywhere the land is free", () => {
    // every dry point of the home island well clear of the plots: most take a
    // new plot right there, and the spots are as many as the free land
    const r = rs[3]!;
    const plots = Object.values(P.plots).flat();
    let free = 0;
    let fits = 0;
    const spots = new Set<string>();
    for (const [x, y] of homeGrid()) {
      const t = newPlotAt(M, P, rs, r.id, x, y);
      if (t) {
        spots.add(`${t.plot.x},${t.plot.y}`);
        // a road-side spot stands back from its road: near, not on, the point
        expect(Math.hypot(t.plot.x - x, (t.plot.y - y) * 1.2)).toBeLessThan(
          260,
        );
        const N = applyMove(M, P, rs, r.id, t);
        const landed = plotById(N, N.occupant[r.id])!;
        for (const q of Object.values(N.plots).flat())
          if (q.id !== landed.id && !q.retired)
            expect(plotsClash(landed, q)).toBe(false);
      }
      if (plots.some((q) => Math.hypot(q.x - x, q.y - y) < 300)) continue;
      free++;
      if (t) fits++;
    }
    expect(fits / free).toBeGreaterThan(0.3);
    expect(spots.size).toBeGreaterThan(20);
  });

  test("no new plot on the water", () => {
    expect(newPlotAt(M, P, rs, rs[0]!.id, -50000, -50000)).toBeNull();
    expect(newPlotAt(M, P, rs, rs[0]!.id, home.cx, home.cy - 4000)).toBeNull();
  });

  test("a retired plot is no land: not drawn, not a target, never taken", () => {
    const gone = rs[5]!;
    const lot = fromOf(gone.id);
    const plots = { ...P.plots };
    plots[lot.slot] = plots[lot.slot]!.map((p) =>
      p.id === lot.id ? { ...p, retired: true } : p,
    );
    const R: Placement = { plots, occupant: P.occupant };
    const present = rs.filter((r) => r !== gone);
    expect(layoutWorld(M, R, present).lots.map((p) => p.id)).not.toContain(
      lot.id,
    );
    for (const r of present)
      expect(
        moveTargets(M, R, present, r.id).some((t) => t.plot.id === lot.id),
      ).toBe(false);
    // back, its app is placed anew rather than on the struck-out plot
    const back = placeResidents(M, R, rs);
    expect(back.occupant[gone.id]).toBeDefined();
    expect(back.occupant[gone.id]).not.toBe(lot.id);
  });
});

describe("isle roads, worn into footpaths", () => {
  for (const [seed, n] of [
    [7, 40],
    [1, 142],
  ] as const) {
    test(`no road crosses a plot's band, and every lane reaches a road: ${n} apps`, () => {
      const M = new WorldModel(seed);
      const rs = residents(n);
      const P = placeResidents(M, EMPTY_PLACEMENT, rs);
      const t0 = performance.now();
      const L = layoutWorld(M, P, rs);
      expect(performance.now() - t0).toBeLessThan(4000);
      expect(layoutWorld(M, P, rs).roads).toEqual(L.roads);
      const plots = Object.values(P.plots)
        .flat()
        .filter((p) => !p.retired && !p.wild);
      const inBand = (x: number, y: number, skip: string | null) =>
        plots.find(
          (p) =>
            p.id !== skip &&
            x > p.x + p.g[0] &&
            x < p.x + p.g[2] &&
            y > p.y + p.g[1] &&
            y < p.y + p.g[3],
        );
      for (const r of L.roads) {
        const own = r.key.startsWith("ln:")
          ? (plots.find((p) => r.key.endsWith(`:${p.id}`))?.id ?? null)
          : null;
        for (const [x, y] of r.pts) {
          const hit = inBand(x, y, own);
          if (hit) throw new Error(`road ${r.key} crosses plot ${hit.id}`);
        }
        if (!own) continue;
        const [ex, ey] = r.pts[r.pts.length - 1]!;
        const joins =
          L.squares.some((q) => Math.hypot(q.x - ex, q.y - ey) < q.r) ||
          L.roads.some(
            (o) =>
              o !== r &&
              o.pts.some(([x, y]) => Math.hypot(x - ex, y - ey) < o.R + 6),
          );
        if (!joins) throw new Error(`lane ${r.key} reaches no road`);
      }
    });

    test(`the lanes are a minimal network — short, shared, never side by side: ${n} apps`, () => {
      const M = new WorldModel(seed);
      const rs = residents(n);
      const P = placeResidents(M, EMPTY_PLACEMENT, rs);
      const L = layoutWorld(M, P, rs);
      const plots = Object.values(P.plots).flat();
      const len = (pts: readonly (readonly [number, number])[]) => {
        let s = 0;
        for (let i = 1; i < pts.length; i++)
          s += Math.hypot(
            pts[i]![0] - pts[i - 1]![0],
            pts[i]![1] - pts[i - 1]![1],
          );
        return s;
      };
      const lanes = L.roads.filter((r) => r.key.startsWith("ln:"));
      expect(lanes.length).toBe(n);
      // a road's run, less where a lane comes in to join another (its last 60 px)
      const body = new Map(
        L.roads.map((o) => {
          if (!o.key.startsWith("ln:")) return [o, o.pts] as const;
          const l = len(o.pts);
          let arc = 0;
          return [
            o,
            o.pts.filter((q, i) => {
              if (i)
                arc += Math.hypot(
                  q[0] - o.pts[i - 1]![0],
                  q[1] - o.pts[i - 1]![1],
                );
              return l - arc > 60;
            }),
          ] as const;
        }),
      );
      let total = 0;
      for (const r of lanes) {
        const p = plots.find((q) => r.key.endsWith(`:${q.id}`))!;
        const l = len(r.pts);
        total += l;
        // no longer than a fairly straight way to where it joins, plus (for a
        // door facing away from its road) the way round its own plot's band
        const [ax, ay] = r.pts[0]!;
        const [bx, by] = r.pts[r.pts.length - 1]!;
        const round = by < p.y ? p.g[2] - p.g[0] + (p.g[3] - p.g[1]) : 0;
        const most = 1.45 * Math.hypot(bx - ax, by - ay) + round + 40;
        if (l > most)
          throw new Error(
            `lane ${r.key} is ${l.toFixed(0)} px long, over ${most.toFixed(0)}`,
          );
        // nowhere beside another road for long: a path that comes near one joins it
        let arc = 0;
        let run = 0;
        for (let i = 1; i < r.pts.length; i++) {
          const [x, y] = r.pts[i]!;
          const step = Math.hypot(x - r.pts[i - 1]![0], y - r.pts[i - 1]![1]);
          arc += step;
          const beside =
            arc > 50 &&
            l - arc > 50 &&
            L.roads.some(
              (o) =>
                o !== r &&
                o.bbox[0] < x &&
                o.bbox[2] > x &&
                o.bbox[1] < y &&
                o.bbox[3] > y &&
                body
                  .get(o)!
                  .some(([ox, oy]) => Math.hypot(ox - x, oy - y) < 20),
            );
          run = beside ? run + step : 0;
          if (run > 70)
            throw new Error(`lane ${r.key} runs beside another road`);
        }
      }
      // and together far shorter than each door's own routed lane was
      const routed = plots.reduce((s, p) => s + len(p.lane), 0);
      expect(total).toBeLessThan(routed * 0.75);
    });
  }
});
