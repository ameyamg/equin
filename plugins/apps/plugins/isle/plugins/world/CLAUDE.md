# world

Isle's world as pure data: a deterministic function of (seed, ordered residents, stored placement).
No DOM, no canvas. A port of the prototype `proto-1794374690-9xmb84`'s `islands.js` and the pure half of
`scene-island.js`, same shapes and placement rules.

- `WorldModel(seed)` — the archipelago: hand-shaped home (Equin Isle: lake, river, dock) plus generated
  islands (`planIsland`: soft primitives → signed-distance height grid), each with district slots and
  hills. Everything lazy and memoised: an island's shape is rasterised on first read.
- `placeResidents(world, placement, residents)` → a new `Placement`. **Append-only**: an app keeps its
  plot; a plot outlives its app as a lot a later app may take. A `Resident` is an app's id, its **group**
  (the leaf category tag id it is filed under) and **region** (that tag's root id) — both `NO_GROUP` (`"_"`)
  for an uncategorised app — and its building's DECLARED footprint (`buildings/core`) — placement never
  paints or measures, nor reads the category tree: the caller passes group and region. Build one with
  `residentOf(app, spec)`.
- **Grouped by category, densely.** A district holds the apps of ONE **region** (the root of their
  category tag; `districtRegion`: a district's kind is its first plot's region). A new app joins a district
  of its own region — the spot its setting likes best (`bestSpot` tries every candidate before calling a
  district full), the emptier district breaking ties — on a lot it fits or a new plot. A region with no
  district opens one on the slot that holds the most of its apps still to come in this call (each tried in
  turn on a copy of the island's plots, up to `KIN_TRIAL`), so a big category gets a big district; it opens
  another only when no spot of its own fits. A new island only when the revealed sites are all taken (home
  holds five districts — the default tree's five roots). A plot keeps the `group` / `region` it was made
  for (append-only: re-filing never moves a building).
- `moveTargets` / `newPlotAt` / `applyMove` — moving a building by hand. `moveTargets` lists the
  existing plots it may go to; the first is always `stay` (its own plot: a drop over its old spot reuses
  it, nothing written), then lots it fits and swaps. `newPlotAt(x, y)` is a drop anywhere else: the
  nearest spot to the point, on any revealed island's land, where it stands clear and its door's lane
  reaches a road (null on water or where nothing fits) — the renderer asks it live under the cursor.
  The plot it leaves is an empty lot in the way of every other target but a swap, so no new plot or
  refit is ever made over it. `restoreLot` gives an empty lot back to nature (`wild`).
- A plot is never deleted (ids are positional, `<district>:<n>`). One made over another plot — before
  2026-11-15 a move could set a building's new plot down on the lot it left — is `retired`: kept for
  its place, but no land at all (never drawn, never taken, in no one's way).
- `layoutWorld(world, placement, residents)` — what is revealed: islands, roads (with samples and
  bridge flags), squares, buildings, empty lots, ferries, piers, the world rect.
  Roads are **laid as footpaths at layout time** (`footpath.ts`, `wornRoads` in `layout.ts`); the routed
  lines (`roads.ts` trunks, a plot's stored `lane`) are what placement checks clearances against and are
  never changed, so stored plots stay valid. `Road.pts` / `samples` — what is painted, stamped on the walk
  grid and walked by villagers — are:
  - trunks and streets: the routed line, chained through square-less nodes, drawn into a road it runs
    beside, corners rounded and a wander added, each point only as far as the nearest plot's band allows;
  - **door lanes: a minimal network, not the stored lane.** Each door takes the cheapest way over free
    ground (off every plot's band, off water; `cheapestWay`: Dijkstra on an 8 px grid, pulled taut) to the
    network as it stands — a trunk, a street, a square or a lane already laid — nearest doors first, so
    neighbours share a lane and none runs beside another. The stored `lane` is only the fallback when no
    way is within reach. A new building is another obstacle and another spur: lanes it does not block or
    shorten stay as they were. A door facing away from its road still has to go round its own band.
  A road's key carries a hash of its shape (tiles repaint when it moves).
- `walkGrid(world, layout, solids?)` + `findPath` — the 16 px walk grid and A*.
- `districtLabels` / `pickLabelSpot` / `islandLabels` — map labels; the renderer picks a spot at the
  label's on-screen size. A district's name comes from its kind — the look of its region's buildings
  (`buildingStyleOf`) — in the order the districts opened (Workshop Quarter, Forge Row, Music Row…).

The tests (`core/internal/world.test.ts`) pin the invariants: same seed → deep-equal world; adding an app
never moves a plot (40 → 41, 14 → 142 one by one); no plot clashes at 14 / 40 / 142; A* stays walkable.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: Isle's world as pure data, deterministic from (seed, residents, stored placement): the archipelago (hand-shaped home plus generated island shapes), district slots and hills, append-only plot placement from each building's declared footprint, the revealed layout (roads, squares, buildings, lots, ferries), the walk grid with A*, and map labels.
- Core:
  - Uses:
    - `apps/isle/buildings.Box`
    - `apps/isle/buildings.BuildingStyle`
    - `apps/isle/buildings.buildingStyleOf`
    - `apps/isle/buildings.Footprint`
    - `apps/isle/buildings.GROUND_BAND`
    - `apps/isle/buildings.Setting`
    - `apps/isle/buildings.SETTINGS`
    - `packages/seeded-random.mulberry32`
    - `packages/string-hash.fnv1a32`
  - Exports (types):
    - `CoastPoint`
    - `DistrictLabel`
    - `Ferry`
    - `Hill`
    - `IslandKind`
    - `IslandLabel`
    - `IslandOptions`
    - `IslandPlan`
    - `IslandShape`
    - `IslandShapeData`
    - `Layout`
    - `MoveTarget`
    - `Pier`
    - `PlacedBuilding`
    - `Placement`
    - `Plot`
    - `PlotBoxes`
    - `PointIndex`
    - `Pt`
    - `Resident`
    - `Road`
    - `RoadKind`
    - `RoadSample`
    - `Solid`
    - `Square`
    - `WalkGrid`
  - Exports (values):
    - `adoptHomeCarve`
    - `applyMove`
    - `arcsOf`
    - `cutAt`
    - `districtLabels`
    - `districtName`
    - `districtRegion`
    - `DOCK_ROOT`
    - `EMPTY_PLACEMENT`
    - `fbm`
    - `findPath`
    - `hash`
    - `HOME_CX`
    - `HOME_CY`
    - `HOME_RX`
    - `HOME_RY`
    - `homeAt`
    - `homeCarveBuilt`
    - `homeCarveGrid`
    - `Island`
    - `ISLAND_COUNT`
    - `islandLabels`
    - `islandsInPlay`
    - `kindOf`
    - `labelSpotScore`
    - `LAKE`
    - `layoutWorld`
    - `moveTargets`
    - `newPlotAt`
    - `NO_GROUP`
    - `pickLabelSpot`
    - `placeResidents`
    - `planIsland`
    - `plotBox`
    - `plotBoxes`
    - `plotById`
    - `plotsClash`
    - `pointIndex`
    - `residentOf`
    - `restoreLot`
    - `RIVER`
    - `riverWidth`
    - `roadHash`
    - `routeAround`
    - `segDist`
    - `signHalfWidth`
    - `Slot`
    - `smoothstep`
    - `spline`
    - `vnoise`
    - `WALK_CELL`
    - `walkable`
    - `walkGrid`
    - `WorldModel`
- Cross-plugin:
  - Imported by:
    - `apps/isle/renderer`
    - `apps/isle/world-view`

<!-- AUTOGENERATED:END -->
