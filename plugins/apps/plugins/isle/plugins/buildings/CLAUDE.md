# isle / buildings

The building contract of the Isle app, the painting kit buildings are drawn
with, and the generator that gives every app without bespoke art a building.

- **`core/spec.ts`** — `BuildingSpec`: a `footprint`, the `setting` it likes,
  `signX`, night `lights`, `paint` (the static picture, cached per time of day),
  `animate` (a swing, a beam) and the `door` the engine opens while the player
  stands at it (`openDoor`). Every door declares its doorway's shape (`w`, `h`,
  `head`, `y`) — required by the type, so no building can have a door with no
  open state: a `leaf` opens onto its reveal, sill and a warm-lit room; an
  `opening` (a bay, a tent, a stage) keeps its painted inside and its lamps
  come on.
  Coordinates are
  door-relative: (0, 0) is the middle of the threshold, y grows down.
- **The painting kit** (`core/internal/{colour,draw,parts,props}.ts`, exported
  from the barrel) — colour helpers (`mix`, `jit`, `accent`…) and drawing
  helpers (`stones`, `planks`, `shingles`, `thatch`, `wash`, `sketch`, `grain`,
  `windowRect`, `doorArch`, props…), all typed against `Ctx2D` and drawing their
  randomness from the `rnd` they are handed in a fixed order: the same stream
  paints the same picture. Bespoke buildings reuse them.
- **`polyKit`** (`core/internal/poly-kit.ts`) — the kit's second hand,
  namespaced: faces as polygons (stone, boards, log courses, slates clipped to
  a point list), palette colour, ink that strokes the current path, and `box`
  (a high-3/4 house in one call). Seven of the bespoke buildings are drawn
  with it, faithful to the prototype's `buildings-b.js`.
- **`web/` — the `Isle.Building` slot** `{ app: AppRef, building: BuildingSpec }`.
  Each app contributes its own building from its own deferred
  `apps/<app>/plugins/isle-building` sub-plugin (`core/` the painter and spec,
  `web/` only the contribution). `useIsleBuildings()` reads them by app id and
  stays `loading` until the deferred tier has settled — a plot is sized from
  the building, so an app is never placed with a stand-in. No contribution: a
  `kitBuilding`.
- **`kitBuilding(app, style, seed?)`** — the generator. `style` is one of the
  closed `BUILDING_STYLES` (workshop, atelier, music hall, homestead, archive,
  fairground, mill looks — they bias the archetype, the props and the setting);
  `buildingStyleOf(key)` hashes any key onto one (Isle keys it on the app's
  region tag, so a region's buildings look alike). `plan.ts` makes
  every choice (archetype by style, walls, roof, chimney, porch…) from
  `mulberry32(seed)`; `paint.ts` only executes the plan. Same seed, same
  building. Neither `paint` nor `animate` mutates the plan.
- **`core/testing`** — `paintedExtent(draw, splitY)` paints on a measuring
  context (bun has no canvas) and returns the ink above/below a line;
  `boxWithin`; and `testBuildingFootprint(appId, spec)`, the one-line suite
  every bespoke building runs: painted by day, dusk and night, animated at 160
  moments, its door opened, its ink must lie inside the declared
  footprint and no side may be looser than `FOOTPRINT_SLACK` (16 px). Glows
  (`lighter` draws: a lighthouse's beams) are light, not ink — not measured.
  A bespoke footprint is hard-coded from `measureBuilding`'s answer.

## What a building's shape is: `paint` + `animate`, never `ambient`

One rule decides what the pointer hits and what the hover light outlines and
washes (`renderer`'s `BuildingArt.drawHover`): **the building's shape is its
static paint plus its moving parts where they stand right now.**

- `paint` — the static mass. A pixel counts once it is `SOLID_ALPHA` opaque;
  fainter paint (a shadow, a wash on the grass) lies under the building. The
  kit's shadows (`castShadow`, `fittings.ellShadow`) hold themselves under
  `SHADOW_ALPHA_MAX`, so that even two overlapping stay out of the shape; a
  shadow drawn by hand must too (a shadow that reaches `SOLID_ALPHA` gets a
  rim of light round it on hover).
- `animate` — the building's own moving parts (a crane's load, a sail, a
  flag, a drawer). The rim runs round the outline of paint and parts
  together, recomputed every frame for the hovered building: no rim where a
  part covers a static edge, no part cut by the wash. A part that moves must
  be drawn ONLY here — never also in `paint` at a rest position.
- `ambient` — what lives around it: creatures that roam (ants, moths, a
  pigeon, automata walking the yard) and what drifts loose (sparks, steam,
  confetti, falling paper). Drawn over the hover light and cut out of it;
  never hit, never outlined. A halo round every ant flickers as it walks —
  that is what this slot exists to make impossible.

The footprint test measures all three.

## One projection: `oblique`

The island is seen in a high 3/4 view: a building shows its front flat-on, a
sliver of its RIGHT side and its top, and everything that goes back into the
picture recedes along ONE vector — `d` px of depth are `d` px right and
`oblique.SLANT · d` px up. `core/internal/oblique.ts` is the only place that
spells it. A building never draws a side face by hand:

- **Declare the volume, get its faces**: `oblique.box({ x0, x1, yb, yt, d })`
  (front, side, top), `sideFace` / `topFace`, `extrude(a, b, d)` (the face any
  front edge sweeps going back: a battered wall, a roof plane), `gableRoof`,
  `gableFront`, `hipRoof`, and `project` / `at` for a shape given as 3D points
  (a curved plan, a propped lid). A `Face` is painted with
  `oblique.fill(g, face, (pts) => …)`, `shadeFace`, `inkFace`.
- **Paint in face space**: inside `oblique.onSide(g, x, draw)` x is the depth
  behind the front's right edge, so a wall painted flat (courses, boards, a
  window, a door) comes out sheared onto the side; `onTop(g, y, draw)` does the
  same for a top (a deck, a lid), `onSlope` for a roof plane.
- **A shape that is no box has thickness too**: `oblique.rim(outline, d)`
  gives the receding band an arbitrary front outline shows (a jigsaw knob, a
  cog, a plate) — the faces that look right or up, each with how much it
  faces the sky, and the ink of its far edge; for a notch cut INTO a body
  (outline run the other way) the same rule gives the inner wall and floor.
  `oblique.paintRim(g, rim, (up) => colour)` paints it; the front goes over
  it. A disc stuck flat on a body that has depth is a defect.
- **`oblique.solid(g, box, { front, side, top })`** paints a whole box (side
  sheared and shaded, top, front, outlines) — crates, piers, stacks, steps'
  cheeks.
- Round things (a drum, a tent, a dome) have no side wall; their boxes do
  (bases, annexes, props). `oblique.ry(rx)` is the kit's flattening of a
  horizontal circle.

**Enforced** by `perspectiveProblems` (`core/testing`), which
`testBuildingFootprint` runs for every building: the measuring context records
the straight edges of every polygon `paint` fills or clips to, and whether the
projection was drawing (`projection-scope.ts`). A hand-drawn edge within 6° of
the receding direction (10 px or longer) fails — parallel to the vector or not,
a side face spelled by hand is one more place to get the view wrong. A diagonal
that is no receding edge (a roof pitch, a brace) goes in `oblique.diagonal`.
What the test cannot see: a side wall drawn as a flat rectangle, or not drawn —
that is still a review matter. No building is exempt, the generated ones
included (`kit-building.test.ts` runs it over its whole sample).

A generated building's rectangular body is `SIDE_D` (18 px) deep
(`layout.ts`): `paint.ts` paints its right side wall in side-face space (its
material, plinth, string course, narrow windows), `roofShape` places every roof
plane and the receding right end (a gable wall, a hip plane, a gambrel end)
with the projection, a lean-to on the right shows its end, the chimney and the
dormers' cheeks are boxes — and `footprint.ts` declares all of it from the
same shapes. Towers and huts are round: no side wall.

## Why the footprint is declared

Placement must be a pure function of the specs, so a building *declares* what
it covers (`footprint.ground` below y = -`GROUND_BAND`, `footprint.upper`
above) instead of the engine painting it to measure. For a kit building
`footprint.ts` computes the boxes analytically from the plan, mirroring what
`paint` and `animate` draw (the geometry both read is shared in `layout.ts`).
`kit-building.test.ts` paints 300+ generated buildings on the measuring
context and checks the ink stays inside the declared boxes and that the boxes
are tight. A change to a painter that draws outside its declared box fails
there — widen the matching box in `footprint.ts`. The measuring context widens
every stroke by √2 (it cannot know the join), which the declared pads allow for.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: Isle's building contract (BuildingSpec: a declared footprint, preferred setting, sign, night lights, paint/animate on any 2D context), the watercolour-and-ink painting kit bespoke buildings reuse, and kitBuilding — a generated building per app, seeded from its id and shaped by its style (one of a closed set, picked by hashing a key). Its testing barrel measures a painter's ink without a canvas. Isle.Building: the slot an app contributes its bespoke building to (keyed by its AppRef, from its own isle-building sub-plugin); useIsleBuildings reads them by app id, loading until the deferred tier has settled.
- Web:
  - Slots: `Isle.Building`
  - Slot contributors:
    - `Isle.Building` ← `apps.agent-manager.isle-building`
    - `Isle.Building` ← `apps.browser.isle-building`
    - `Isle.Building` ← `apps.chord.isle-building`
    - `Isle.Building` ← `apps.debug.isle-building`
    - `Isle.Building` ← `apps.deploy.isle-building`
    - `Isle.Building` ← `apps.desktop.isle-building`
    - `Isle.Building` ← `apps.events.isle-building`
    - `Isle.Building` ← `apps.file-explorer.isle-building`
    - `Isle.Building` ← `apps.home.isle-building`
    - `Isle.Building` ← `apps.keyboard-party.isle-building`
    - `Isle.Building` ← `apps.mail.isle-building`
    - `Isle.Building` ← `apps.pages.isle-building`
    - `Isle.Building` ← `apps.places.isle-building`
    - `Isle.Building` ← `apps.plugin-studio.isle-building`
    - `Isle.Building` ← `apps.prototypes.isle-building`
    - `Isle.Building` ← `apps.settings.isle-building`
    - `Isle.Building` ← `apps.sonata.isle-building`
    - `Isle.Building` ← `apps.website.isle-building`
  - Exports (types): `IsleBuildingContribution`
  - Exports (values):
    - `Isle`
    - `useIsleBuildings`
- Core:
  - Uses:
    - `packages/seeded-random.mulberry32`
    - `packages/string-hash.fnv1a32`
  - Exports (types):
    - `Box`
    - `BoxFaces`
    - `BoxGeom`
    - `BuildingSpec`
    - `BuildingStyle`
    - `Chimney`
    - `Ctx2D`
    - `Door`
    - `DoorArchOptions`
    - `Face`
    - `Footprint`
    - `Light`
    - `P3`
    - `PaintState`
    - `PlanksOptions`
    - `Pt`
    - `Rgb`
    - `Rim`
    - `Rnd`
    - `RoofGeom`
    - `Setting`
    - `ShinglesOptions`
    - `SolidPaint`
    - `StonesOptions`
    - `WashOptions`
    - `WindowOptions`
  - Exports (values):
    - `accent`
    - `barrel`
    - `bbox`
    - `bench`
    - `books`
    - `BUILDING_STYLES`
    - `buildingStyleOf`
    - `cart`
    - `castShadow`
    - `chimneySmoke`
    - `crate`
    - `css`
    - `dark`
    - `doorArch`
    - `draftingTable`
    - `easel`
    - `fittings`
    - `flowerBox`
    - `gear`
    - `grain`
    - `GROUND_BAND`
    - `hline`
    - `ink`
    - `ivy`
    - `jit`
    - `kitBuilding`
    - `ladder`
    - `lantern`
    - `light`
    - `lute`
    - `mailbox`
    - `mix`
    - `moss`
    - `oblique`
    - `openDoor`
    - `planks`
    - `poly`
    - `polyKit`
    - `rectPts`
    - `rgb`
    - `sack`
    - `SETTINGS`
    - `shade`
    - `SHADOW_ALPHA_MAX`
    - `shingles`
    - `shrub`
    - `sketch`
    - `SOLID_ALPHA`
    - `steps`
    - `stones`
    - `swingFrame`
    - `thatch`
    - `toolRack`
    - `tufts`
    - `wash`
    - `waterButt`
    - `windowRect`
- Cross-plugin:
  - Imported by: 22 plugins — full list in [REFERENCE.md](./REFERENCE.md)
    - `apps` ×22
- Test helpers:
  - Core: `@plugins/apps/plugins/isle/plugins/buildings/core/testing`
    - `boxWithin` — Whether `inner` lies inside `outer`, give or take `tolerance` px on each side.
    - `FOOTPRINT_SLACK` — How far a declared side may lie beyond the measured ink, px.
    - `footprintProblems` — Every way a building's declared footprint disagrees with its ink (none: it holds).
    - `measureBuilding` — All the ink a building paints and animates, in every light, split at the ground band.
    - `paintedExtent` — Runs `draw` against a measuring context (no canvas needed) and returns where it put ink, in the coordinates `draw` starts in, split at `splitY`.
    - `perspectiveProblems` — Every receding edge a building spells by hand (none: its perspective holds).
    - `testBuildingFootprint` — Registers the footprint suite of one app's building: `testBuildingFootprint("places", lighthouse)`.
    - Types: `PaintedExtent`

<!-- AUTOGENERATED:END -->
