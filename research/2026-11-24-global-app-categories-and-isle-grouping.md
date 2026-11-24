# App categories as a nested tag tree + category-first Isle placement

## Context

On Isle, buildings look scattered: every district on the home island mixes 4–5 categories (live `isle_plots`
on main: district 0.0 holds Deploy, Prototypes, Mail, Tap Tap Party, Studio, Debug, Agent Manager; Chord and
Sonata sit in different districts). Causes, in `world/core/internal/placement.ts` + `sites.ts`:

1. A building's preferred setting scores 10 / 6 (`tagScore`), the kin district only +2 — setting wins.
2. A district's kind is whatever app landed first (`districtCategory` = first plot's category), often a
   landmark that came for the coast/hill.
3. Districts open cheaply (`openCost` 1 while below `ceil(n/5)` districts), so apps spread before groups form.
4. Append-only: nothing ever re-plans, so a better rule alone would not fix today's island.

And the category itself is a flat closed enum in code (`APP_CATEGORIES` in `primitives/pane/core/route.ts`:
work/create/music/life/data/play/system), read **only** by Isle, not editable, not shown in the Home gallery.

Outcome wanted (user): categories are a **nested, user-editable tag tree**, a property of the app shown and
editable wherever apps are listed (Home gallery: group / sort / filter / edit), and Isle lays out one district
per category, related categories side by side, with a one-shot **Tidy up** that re-plans everything (hand-moved
buildings included).

## Default tree

| Tag | Apps |
|---|---|
| Harness | Agent Manager, Prototypes |
| Publishing | Plugins (studio), Deploy, Website |
| Office | Mail, Files, Pages, Places, Events, Browser |
| Leisure › Music | Sonata, Chord |
| Leisure › Games | Tap Tap Party |
| System | Settings, Debug |
| System › Launcher | Desktop, Home, Isle |

Unlisted apps (menu-bar, browser-extension, circle) declare nothing and are uncategorised (no tag).

## Design

### 1. `defineApp({ category })` becomes a default path

- `primitives/pane/core/route.ts`: `category?: readonly [string, ...string[]]` — the tag path the app is filed
  under **by default** (`["Leisure", "Music"]`). Delete `AppCategory` / `APP_CATEGORIES` (only Isle reads them).
- Each `apps/*/plugins/shell/core/app.ts` declares its path per the table above (Home and Website gain one).
- The path is plain data, so it rides in the `Apps.App` list fact (`declaredApps()` already carries the whole
  `AppRef`); the server reads it from there — verify the fact includes it once the field exists.

### 2. New plugin `apps-core/plugins/app-category`

Owns the tree and each app's assignment (apps are code, not rows, so the assignment is its own table).

- **core**: `appCategoryTags = tagTreeEntityRef("app_category_tags", …)`, `appCategoryTree = defineTagTree({
  id: "app-categories", … })` (pattern: `apps/places/plugins/places-core/core/internal/{entity-refs,resources}.ts`),
  and `appCategories` — a live collection `(appId pk, tagId | null)` (`liveCollection`, `all: { max }` — the app
  count is small and bounded by the registry).
- **server**:
  - `defineTagTreeTable(appCategoryTags)`; table `app_categories(app_id text pk, tag_id text null)`.
  - `TagTrees.Tree(serveTagTree(appCategoryTree, { carriers: [singleTagCarrier(appCategories, tagId)] }))` —
    deleting a tag lifts its apps to the parent (engine behaviour).
  - **Seed warmup** (`defineWarmup`, precedent `places-core/server/internal/seed.ts`): under the table lock,
    for every `declaredApps()` app with no `app_categories` row, resolve its default path (create missing
    segments, case-insensitive like `/paths`) and insert the row. Runs every boot, so a newly installed app is
    filed once; a row the user changed is never touched (no row = never filed; `tag_id null` = user cleared it).
  - `POST /api/app-categories/assign { appId, tagId | null }` — the one write.
- **web**: `useAppCategory(appId)` / `useAppCategories()` (map appId → tag path), and a `ClientFields.Resolve`
  adding `category` to `installedApp` (precedent: `apps/home/plugins/usage-fields`), typed as the existing
  **`tag` field type** (`fields/plugins/tag`: options = `tagFieldOptions(tags)`, nested grouping comes free —
  precedent `apps/prototypes/plugins/gallery/web/internal/gallery-fields.tsx`). Edit = `TagPickerPopover`
  (`tag-tree/plugins/picker`) with `offerNone`, `onPick` → assign.

### 3. Home gallery

`apps/home/plugins/app-cards`: the Category column/field shows up in table view, groupable (nested sections
along the tree), sortable, filterable, editable inline; the icons view can group by it. A row action
"Change category…" opens the picker. No code names a contributor — the field arrives through `installedApp`.

### 4. Isle: category-first placement

- `Resident.category: AppCategory` → `Resident.group: { leaf: string; root: string } | null` — the app's tag id
  and its root tag id (uncategorised → a reserved `"_"` group). `use-isle-world.ts` builds it from
  `useAppCategories()`; until the categories are loaded, Isle shows its loading state (no placement on unknown).
- `placement.ts` scoring, per new app:
  - Candidate districts = open districts holding its **leaf** group; a new district is opened only when none
    has room (or none exists). Opening is **mandatory** for a new group, never shared with another group.
  - Where a new district opens: a free slot on the island already holding its **root** group, nearest to that
    group's districts; else the next island (a root claims an island). So Leisure › Music and Games are
    neighbours, System and System › Launcher too.
  - Within the district, the setting still picks the spot (`bestSpot` / `tagScore` unchanged). A landmark that
    wants the coast takes the district's coast spot if it has one, never leaves its district for it.
  - Remove `kin` / the `ceil(n/5)` open-cost rule (the number of districts is now the number of groups).
- `Plot.category` (persisted, `z.enum(APP_CATEGORIES)` in `plots/core/internal/schemas.ts`) → `Plot.group`
  (text, the leaf tag id). Migration renames/retypes the column; `LAYOUT_GENERATION` bump (5 → 6) starts every
  world fresh, which is also the first Tidy.
- **Labels** (`labels.ts`): a district's sign is its **tag's name** (user-renamable), Roman numeral for a second
  district of the same tag; drop `CAT_NAMES`. Island labels stay.
- **Generated buildings** (`buildings/core/internal/plan.ts` keyed on `AppCategory`): key the kit's style on a
  hash of the root tag id over the existing style table (no meaning lost that was real; a style per tag later).
- Dev growth exhibit (`dev/exhibits/internal/{growth.tsx,fake-apps.ts}`): fake apps get fake paths over a fixed
  fake tree; `addTo(cat)` becomes `addTo(tag)`.

### 5. Tidy up

- `POST /api/isle/plots/reset { world }` (`plots/server/internal/routes.ts`): deletes every row of that world in
  one transaction. Plot ids are positional *within* a world, so dropping the whole world keeps that invariant.
  The view then places every app from `EMPTY_PLACEMENT` (the existing first-visit path) and claims.
- A **Tidy up** button on Isle's title card (world-view). It ignores `moved_by_user` (user: hand-moved
  buildings may be reorganised). It's highlighted when an app's plot is in a district of another group (app
  re-categorised since it was placed), with the count.

## Critical files

- `plugins/primitives/plugins/pane/core/route.ts` (+ every `apps/*/plugins/shell/core/app.ts`)
- new `plugins/apps-core/plugins/app-category/{core,server,web}`
- `plugins/apps/plugins/home/plugins/app-cards/web/components/app-grid.tsx`
- `plugins/apps/plugins/isle/plugins/world/core/internal/{placement,resident,labels,move}.ts`
- `plugins/apps/plugins/isle/plugins/plots/{core/internal/schemas.ts,core/internal/resources.ts,server/internal/{tables,routes}.ts}`
- `plugins/apps/plugins/isle/plugins/world-view/web/internal/use-isle-world.ts`, buildings `plan.ts`, dev exhibit

## Verification

- `world.test.ts`: keep determinism / append-only / no-overlap / islands-in-play / restore-move tests (fixture
  `fakeResident` gets groups over a fake tree); **new**: every open district holds one group only; districts of
  one root are on one island while it has room; 142 apps still spill to >1 island.
- `./equin test plugins/apps-core/plugins/app-category plugins/apps/plugins/isle`.
- `./equin build`; growth exhibit (`/debug/exhibit/isle/growth`) at 14 / 40 / 142 for a visual check.
- On the build: `/isle` → Tidy up → one sign per category (Office, Music, Games…), Music next to Games;
  `/home` table view grouped by Category, change Mail to Leisure → Isle's Tidy up highlights, tidy moves it.
- `register_before_after` for `/isle` and `/home` (table view).

## Out of scope (follow-ups)

- Suggesting neighbours from co-usage (`app-usage`).
- Per-tag building styles / district decoration.
