import { describe, expect, test } from "bun:test";
import type {
  Box,
  Setting,
} from "@plugins/apps/plugins/isle/plugins/buildings/core";
import {
  EMPTY_PLACEMENT,
  misplacedResidents,
  placeResidents,
  plotById,
  signHalfWidth,
  type Resident,
} from "./placement";
import { plotsClash } from "./sites";
import { WorldModel } from "./world-model";

/**
 * A building as its app declares it: the same footprint, setting and sign as
 * placement reads. `path` is its category, `<root>/<leaf>` (group the whole
 * path, region its root).
 */
function building(
  id: string,
  name: string,
  path: string,
  setting: readonly Setting[],
  w: number,
  depth: number,
  ground: Box,
  upper: Box,
  signX: number,
): Resident {
  return {
    id,
    group: path,
    region: path.split("/")[0]!,
    footprint: { w, depth, ground, upper },
    setting,
    signX,
    signHalf: signHalfWidth(name),
  };
}

// The 18 installed apps' bespoke buildings (Isle itself has none on the map), in
// the rail's order, under their default categories (`Leisure/Music`: group the
// whole path, region its root) — copied from their declarations (each app's
// isle-building core), since world/core names no app. Refresh it when they change.
const TOWN: readonly Resident[] = [
  building(
    "home",
    "Home",
    "System/Launcher",
    ["square", "lane"],
    184,
    72,
    [-197, -112, 187, 37],
    [-112, -301, 141, -112],
    -206,
  ),
  building(
    "agent-manager",
    "Agent Manager",
    "Harness",
    ["lane"],
    276,
    96,
    [-193, -112, 250, 57],
    [-122, -438, 153, -112],
    -204,
  ),
  building(
    "pages",
    "Pages",
    "Office/Documents",
    ["square", "lane"],
    256,
    96,
    [-177, -112, 211, 45],
    [-150, -306, 153, -112],
    -166,
  ),
  building(
    "sonata",
    "Sonata",
    "Leisure/Music",
    ["square"],
    232,
    70,
    [-160, -112, 220, 44],
    [-122, -333, 146, -112],
    -176,
  ),
  building(
    "places",
    "Places",
    "Office/Everyday",
    ["coast", "cape"],
    190,
    96,
    [-153, -112, 206, 51],
    [-75, -418, 75, -112],
    -150,
  ),
  building(
    "prototypes",
    "Prototypes",
    "Harness",
    ["forest"],
    230,
    80,
    [-211, -112, 295, 63],
    [-197, -351, 241, -112],
    -150,
  ),
  building(
    "file-explorer",
    "Files",
    "Office/Documents",
    ["harbour", "shore"],
    240,
    80,
    [-200, -112, 231, 56],
    [-130, -294, 179, -112],
    -175,
  ),
  building(
    "keyboard-party",
    "Keyboard Party",
    "Leisure/Games",
    ["lane", "square"],
    192,
    44,
    [-176, -112, 192, 52],
    [-118, -262, 110, -112],
    -172,
  ),
  building(
    "desktop",
    "Desktop",
    "System/Launcher",
    ["square", "lane"],
    236,
    74,
    [-153, -112, 191, 28],
    [-164, -302, 153, -112],
    -150,
  ),
  building(
    "settings",
    "Settings",
    "System",
    ["hill"],
    270,
    86,
    [-183, -112, 239, 55],
    [-109, -355, 141, -112],
    206,
  ),
  building(
    "mail",
    "Mail",
    "Office/Documents",
    ["square"],
    176,
    66,
    [-163, -112, 233, 51],
    [-128, -373, 132, -112],
    -176,
  ),
  building(
    "events",
    "Events",
    "Office/Everyday",
    ["square"],
    108,
    60,
    [-140, -112, 240, 50],
    [-60, -416, 80, -112],
    -115,
  ),
  building(
    "chord",
    "Chord",
    "Leisure/Music",
    ["square"],
    208,
    74,
    [-183, -112, 184, 51],
    [-116, -292, 116, -112],
    158,
  ),
  building(
    "browser",
    "Browser",
    "Office/Everyday",
    ["hill"],
    184,
    104,
    [-146, -112, 180, 39],
    [-136, -357, 136, -112],
    128,
  ),
  building(
    "studio",
    "Plugins",
    "Publishing",
    ["forest"],
    236,
    80,
    [-205, -112, 215, 59],
    [-140, -246, 136, -112],
    -175,
  ),
  building(
    "website",
    "Website",
    "Publishing",
    ["square", "lane", "harbour"],
    200,
    72,
    [-151, -112, 221, 39],
    [-141, -309, 157, -112],
    -156,
  ),
  building(
    "deploy",
    "Deploy",
    "Publishing",
    ["cape", "coast"],
    264,
    84,
    [-200, -112, 256, 61],
    [-160, -423, 210, -112],
    -236,
  ),
  building(
    "debug",
    "Debug",
    "System",
    ["forest", "hill", "lane"],
    150,
    70,
    [-125, -112, 186, 40],
    [-109, -187, 109, -112],
    -128,
  ),
];

describe("isle landmarks", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    test(`seed ${seed}: the landmarks take their setting within their own group's district`, () => {
      const P = placeResidents(new WorldModel(seed), EMPTY_PLACEMENT, TOWN);
      const tags = (id: string) => {
        const p = plotById(P, P.occupant[id]);
        if (!p) throw new Error(`${id} has no plot`);
        return p.tags;
      };
      // every building stands in a district of its own group…
      expect(misplacedResidents(P, TOWN)).toEqual([]);
      // …the mill (Settings: System, opening its district on a hill) on a hill…
      expect(tags("settings")).toContain("hill");
      // …and of the lighthouse (Places) and the observatory (Browser), both
      // Office › Everyday, the one that opens the district gets its setting
      // (the other only if that district has it too)
      expect(
        tags("places").some((t) => t === "coast" || t === "cape") ||
          tags("browser").includes("hill"),
      ).toBe(true);
      const plots = TOWN.map((r) => plotById(P, P.occupant[r.id])!);
      for (let i = 0; i < plots.length; i++)
        for (let j = i + 1; j < plots.length; j++)
          if (plotsClash(plots[i]!, plots[j]!))
            throw new Error(
              `plots ${plots[i]!.id} and ${plots[j]!.id} overlap`,
            );
    }, 60_000);

    // the 2026-11-24 regression on seed 1: Harness and Music each split over
    // two districts of one building, a district "full" with one building in it
    test(`seed ${seed}: one district per category, its kin side by side`, () => {
      const M = new WorldModel(seed);
      const P = placeResidents(M, EMPTY_PLACEMENT, TOWN);
      const districts = new Map<string, Set<string>>();
      for (const r of TOWN) {
        const slot = P.occupant[r.id]!.split(":")[0]!;
        districts.set(r.group, (districts.get(r.group) ?? new Set()).add(slot));
      }
      for (const [group, slots] of districts)
        expect([group, [...slots]]).toEqual([group, [[...slots][0]!]]);
      // Leisure's two groups (Music, Games) open on one island
      const islandOf = (group: string) =>
        M.slotById.get([...districts.get(group)!][0]!)!.island.id;
      expect(islandOf("Leisure/Games")).toBe(islandOf("Leisure/Music"));
    }, 60_000);
  }
});

describe("a group's apps placed together", () => {
  // landmarks of one group (each wanting a different rare setting) placed in
  // one batch with plain kin: the first opens the district, the rest join it
  const kin = (id: string, setting: readonly Setting[]): Resident =>
    building(
      id,
      id,
      "Kin",
      setting,
      200,
      80,
      [-150, -112, 190, 50],
      [-110, -330, 130, -112],
      -160,
    );
  const other = (id: string): Resident =>
    building(
      id,
      id,
      "Other",
      ["square"],
      120,
      60,
      [-90, -112, 110, 40],
      [-80, -220, 80, -112],
      -96,
    );
  const batch = [
    other("o1"),
    kin("k-coast", ["coast"]),
    kin("k-forest", ["forest"]),
    kin("k-hill", ["hill"]),
    other("o2"),
    kin("k-lane", ["lane"]),
    kin("k-square", ["square"]),
  ];
  for (const seed of [1, 2, 3])
    test(`seed ${seed}: all of them in one district`, () => {
      const P = placeResidents(new WorldModel(seed), EMPTY_PLACEMENT, batch);
      const slots = new Set(
        batch
          .filter((r) => r.group === "Kin")
          .map((r) => P.occupant[r.id]!.split(":")[0]),
      );
      expect(slots.size).toBe(1);
      expect(misplacedResidents(P, batch)).toEqual([]);
    }, 60_000);
});
