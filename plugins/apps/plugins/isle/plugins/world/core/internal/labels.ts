// Map labels: island names, and one name per district that has buildings: the
// name of its group's category tag (Office, Music…), a Roman numeral on the
// second and later districts of one group, in the order they opened. A
// district label goes on whichever of a few spots round its square covers the
// least of its buildings, signs, well and campfire — scored at the label's
// size, which depends on the zoom, so the renderer picks.

import type { Box } from "@plugins/apps/plugins/isle/plugins/buildings/core";
import type { Pt } from "./geometry";
import type { Layout } from "./layout";
import { districtGroup, type Placement } from "./placement";
import type { WorldModel } from "./world-model";

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** The name of the ord-th district (0-based) of a group named `name`: `Music`, `Music II`, … */
export function districtName(name: string, ord: number): string {
  return ord === 0 ? name : `${name} ${NUMERALS[ord] ?? String(ord + 1)}`;
}

export interface IslandLabel {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

/** Each revealed island's name and where it is written (above the island). */
export function islandLabels(layout: Layout): IslandLabel[] {
  return layout.islands.map((I) => ({
    id: I.id,
    name: I.name,
    x: I.cx,
    y: I.cy - I.ry * 0.95,
  }));
}

export interface DistrictLabel {
  readonly slot: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** What the label should not cover, world px. */
  readonly obstacles: readonly Box[];
  /** Candidate centres, best first when nothing is in the way. */
  readonly spots: readonly Pt[];
}

/**
 * The districts' labels: names in the order the districts opened, obstacles and candidate spots. `signHalfOf(appId)` is
 * half each building's signpost board width; `nameOf(group)` the name a group's sign reads (its category tag's name).
 */
export function districtLabels(
  M: WorldModel,
  placement: Placement,
  layout: Layout,
  signHalfOf: (appId: string) => number,
  nameOf: (group: string) => string,
): DistrictLabel[] {
  const ord = new Map<string, number>();
  const names = new Map<string, string>();
  // in the order the districts opened: by their first plot
  const opened = M.slots
    .map((s) => ({
      s,
      first: placement.plots[s.id]?.[0],
      c: districtGroup(placement, s.id),
    }))
    .filter((o) => o.first && o.c)
    .sort((a, b) => a.first!.seq - b.first!.seq);
  for (const { s, c } of opened) {
    const n = ord.get(c!) ?? 0;
    ord.set(c!, n + 1);
    names.set(s.id, districtName(nameOf(c!), n));
  }
  const marks: Box[] = [];
  for (const q of layout.squares) {
    if (q.camp) marks.push([q.x - 35, q.y - 22, q.x + 35, q.y + 18]);
    if (q.well) {
      const wx = q.x + q.r * 0.55;
      const wy = q.y - q.r * 0.25;
      marks.push([wx - 30, wy - 60, wx + 30, wy + 10]);
    }
  }
  return layout.active
    .filter((sl) => names.has(sl.id))
    .map((sl) => {
      const R = 900;
      const obstacles: Box[] = [];
      for (const b of layout.buildings) {
        if (Math.abs(b.x - sl.x) > R || Math.abs(b.y - sl.y) > R) continue;
        const [x0, y0, x1, y1] = b.box;
        const sx = b.x + b.signX;
        const sy = b.y + 12;
        const hw = signHalfOf(b.appId);
        obstacles.push(
          [x0 + 8, y0 + 8, x1 - 8, y1 - 6],
          [sx - hw, sy - 74, sx + hw, sy],
        );
      }
      for (const m of marks)
        if (Math.abs(m[0] - sl.x) < R && Math.abs(m[1] - sl.y) < R)
          obstacles.push(m);
      const r = sl.r || 120;
      const spots = (
        [
          [0, 0],
          [0, 0.55],
          [0, -0.55],
          [0, 1.05],
          [0, -1.05],
          [-1.15, 0.2],
          [1.15, 0.2],
          [0, 1.55],
        ] as const
      ).map(([u, v]): Pt => [sl.x + u * r, sl.y + v * r]);
      return {
        slot: sl.id,
        name: names.get(sl.id)!,
        x: sl.x,
        y: sl.y,
        r,
        obstacles,
        spots,
      };
    });
}

/**
 * How much of a label of half-size (hw, hh) world px at spot i is covered,
 * as a fraction of its area, plus a small preference for earlier spots.
 */
export function labelSpotScore(
  D: DistrictLabel,
  i: number,
  hw: number,
  hh: number,
): number {
  const [x, y] = D.spots[i]!;
  let o = 0;
  for (const B of D.obstacles) {
    o +=
      Math.max(0, Math.min(x + hw, B[2]) - Math.max(x - hw, B[0])) *
      Math.max(0, Math.min(y + hh, B[3]) - Math.max(y - hh, B[1]));
  }
  return o / (4 * hw * hh) + 0.06 * i;
}

/**
 * The spot to write a district label at: `prev` (the one it was at) unless
 * another is clearly better, so the label does not hop while zooming.
 */
export function pickLabelSpot(
  D: DistrictLabel,
  prev: number,
  hw: number,
  hh: number,
): number {
  let best = prev;
  let bs = labelSpotScore(D, prev, hw, hh);
  for (let i = 0; i < D.spots.length; i++) {
    const v = labelSpotScore(D, i, hw, hh);
    if (v < bs - 0.08) {
      bs = v;
      best = i;
    }
  }
  return best;
}
