# Surface parts: feature code writes no spacing

Status: design only (task-1795736652-ptqzei), plus one working family (`Panel`) with five measured exhibits. No app is migrated. An independent review of a first draft found five blockers; this version is the design after them ("Review findings" at the end). Open decisions close the doc.

**In short.** A closed list of surfaces and parts, none of which can state an inset, covers the app's screens well by archetype (94%, an upper bound) and a held-out quarter of the prototypes badly (43% for the frozen list). Two ways of producing the edges were built and measured; the one the brief describes loses, and the recommendation is the rail reduced to two variables and a reset. Nothing here asks for a visual decision yet.

Supersedes the direction of [`2026-11-09-global-surface-owned-inset.md`](2026-11-09-global-surface-owned-inset.md) (its slices 1-3 stay on main and are absorbed, see "Migration"). Companion: [`2026-11-27-global-prototype-fidelity-eval-harness.md`](2026-11-27-global-prototype-fidelity-eval-harness.md), which can measure whether this change helps agents.

## Context

Feature code decides its own spacing. Counted on main today (`.tsx` under `plugins/`, outside `plugins/primitives` and `plugins/ui`):

| | Count |
|---|---|
| Lines with a padding class, `<Inset>` or `insetClass()` | 932 (822 outside Debug); padding classes alone are in 340 files |
| Margin classes | 49 (27 `mx-auto`) |
| `<Inset>` | 191 in 115 files |
| `rail/*` lint disables | 85 (76 in feature files; 73 are `no-adhoc-band`) |
| `rail-follow` / `rail-bleed` in feature code | 29 / 8 matches, about 25 / 6 outside comments (the task's 78 / 23 include primitives) |
| Other region openers in feature code (`rail-lg`, `rail-x-*`, …) | 35 |
| `gap` props / `gap-*` classes | 2076 / 348 |

The rail that is meant to prevent misplacement is a protocol carried through DOM ancestry: 10 variables, 50 utilities, 4 lint rules and a runtime guard that only a few primitives attach. Its own doc lists three silent traps. The 2026-11-09 work on it needed 3-4 review rounds per slice.

**Why the earlier fix did not hold.** Slices 1-3 kept the API (any element takes `className`, any class may pad, `Inset` pads without saying so) and added guards shaped like the incidents (`rail/no-adhoc-band`, `no-unowned-overlay`, `no-pad-under-owner`, each same-file only). The next spelling still compiles. This design changes the API: a part has no way to state an inset.

## Evidence

Three sources. Method and caveats are stated with each number.

### 1. The app: what the 822 hand-padded sites do

A rule-based classifier over every non-Debug site, checked by reading about 110 sites in context; counts are ±15%.

| Role of the padded box | Sites | Becomes |
|---|---|---|
| Section / panel / popover body inset | 92 | Section, Panel body |
| Card or boxed surface body | 71 | Card |
| State stand-in (empty, loading, error) wrapped because its host pays nothing | 59 | State |
| Transcript tool-card body | 53 | Card (collapsible) |
| Column gutter, text-edge alignment | 43 | nothing: content lands on `text` |
| Header / toolbar strip (`border-b` + pad) | 39 + 19 | surface `header` / `toolbar` slots |
| Pane body inset | 38 | Pane body |
| Ruled row, key/value list | 27 | Facts |
| Callout | 16 | Callout |
| Footer / action strip | 16 | surface `footer` slot |
| Reading column (`mx-auto max-w-*` + gutters) | 16 | Pane `layout="reading"` |
| **Subtotal: a part owns it** | **489 (59%)** | |
| Table cells (3 files hand-roll `<table>`) | 64 | `DataTable` adoption |
| Multi-line or bordered option rows | 44 | `Row` |
| Pills, media tags | 42 | `Badge` |
| Code / kbd boxes, input-likes | 20 | existing leaves |
| **Subtotal: a leaf primitive owns it** | **170 (21%)** | |
| Page editor block gutter (`px-md py-xs` per block type) | 65 (8%) | one declared local part in `page` |
| Vertical rhythm only (`pt/pb/py`) | 76 (9%) | body and section rhythm tokens; about 15 optical nudges remain |
| Indent (`pl/pr` only) | 22 (3%) | not in v1 (watch list) |

The classifier's own estimate of true one-offs across those groups: 60-70 sites (8%): mockup geometry in px (desktop shelf, home), canvas-anchored chrome (map, Sonata roll), editor internals, boot screen.

The 48 non-Debug feature disables were all read: 36 are a header or footer bar of a pane, panel or card that owns no inset (26 header, 10 footer), 6 are ruled list rows, 6 are overlays.

### 2. The prototypes: which structures recur

208 prototypes on this host. Split before any was opened: sorted by id, every fourth is held out (`ls -d ~/.equin/apps/prototypes/proto-* | sort | awk 'NR%4==0'`): 156 design, 52 held out. There is no "approved" marker (the `done` flag reads as "handled"), so all 156 were in scope. All 156 were read for structure and layout rules; 9 closely. Counts are regex-based, ±10%.

| Structure | Prototypes (of 156) |
|---|---|
| Bar with a full-width hairline (header, toolbar, column head) | 82 |
| Rounded hover row (nav, menu, tree, list): fill inset from the edge | 80 |
| Card; with head strip 13, foot 4 | 79 |
| Section (label, count, actions; flat, accordion or ruled) | 69 |
| Empty state | 61 |
| Centred max-width column | 52 |
| Footer strip | 45 |
| Horizontal scroll strip (chips, tabs, thumbnails, code) | 44 |
| Hairline row with its own gutter (tables, records) | 41 |
| Popover 40, menu 35 (search first in 8), sheet 14, dialog 10, drawer 3 | one anatomy: head, search, rows, foot |
| Key/value list | about 25 |
| Banner / callout | 14 |

What the prototypes do when something must be wider than the padding around it: 23 use a negative margin. 14 are a **hover-bleed row** (`margin: 0 -N; padding: … N`: the fill is wider than the text column), 4 a full-width divider, 8 a bleeding media block, table or scroller. So the prototypes themselves show three edges: where the surface ends, where a fill starts, where text starts.

Variation a skin absorbs: bar height (44 dominant), paddings, row height, radius, inset-rounded or edge-to-edge fill. Variation that is structure: 11 header shapes, the commonest being a single line with trailing actions (55), stacked bars (12), tabs glued to the hairline (12), a hero image header (6).

### 3. Established design systems (prior for anatomy and names)

- Radix / shadcn: compounds with named parts (`Card` + `CardHeader` / `Content` / `Footer`; `Dialog`, `Command` with `Input` / `List` / `Group` / `Item` / `Separator` / `Empty`). The searchable menu here is `Command`'s anatomy. Their parts take `className`, which is the hole this design closes.
- Material 3: lists define leading / headline / supporting / trailing; canonical layouts (list-detail, feed, supporting pane) are recipes over a pane model, not components.
- Apple HIG: content keeps to layout margins and a readable-content guide while backgrounds extend edge to edge: two lines, with full-bleed as a placement.

The names below follow these where the app has no better word.

## The design

### Terms

- **Surface**: a box that holds content and has edges of its own: a pane, a panel (popover, menu, dialog, sidebar), a card.
- **Region**: one scrolling or fixed area of a surface (its body, or one of its bars).
- **Bar**: a single-line region at the top or bottom of a surface (header, toolbar, footer).
- **Part**: a named component that goes inside a region and has a fixed place in it.
- **Skin**: the token values an app theme gives a surface kind (its distances, heights, radius).

### Three edges per region

| Edge | Is |
|---|---|
| `edge` | the region's box edge |
| `fill` | where a row's hover or selected fill starts |
| `text` | where text and ordinary content start |

A part sits on one of them. Content the system does not know (a bare input, a paragraph, a custom component) starts on `text` by doing nothing. "Full width" is the `edge` placement, offered by a part; feature code never asks for it with a class.

The two distances (`edge → fill`, `fill → text`) are skin. A menu today is 4px + 8px; a pane is 0 + 16px (`documentPadX`). Whether a row's fill is an inset pill or runs edge to edge is the first distance being 4px or 0. The reading column is the same model with a centred `text` column of at most the measure and `edge` still the pane's edge, the case slice 2 could not solve.

The held-out test found three edges are one short where rows have a lead cell (content under a row aligns on its label). v1.1 adds a row-local `label` edge. The exhibit implements three.

### Two mechanisms, measured

The parts API does not depend on how the edges are produced. I built two mechanisms behind the same `Panel` and measured both with the same assertions (`surface-parts/traps`, `…/traps-pad`, `…/wrappers`, `…/wrappers-pad`; distances in px from the panel's edge).

- **Lines** (what the brief describes: nothing cancels a parent's padding). The region is a grid with named column lines; a part is placed on a line; a grouping part is a subgrid.
- **Pad and step out.** The region pads to `text`. A part on `fill` or `edge` steps out by the region's own distance (two variables the region declares). Every box that pads or scrolls without being a region resets those variables to 0, so a part can only step out of the region that declared them.

| Case | Lines | Pad and step out |
|---|---|---|
| Three Sections deep: label, state, row | on `text` / `fill` | on `text` / `fill` |
| Rule, full block, row in a both-axis scroller | reach their edges, stop there | same |
| Inside a `display: contents` wrapper (slot-render wraps every contribution in one) | **text at 0px, squeezed into the 4px first track; row label at 4px** | correct |
| Inside a plain wrapper box (a `Stack`, a component's own root) | **row fill stops 8px short; row label lands mid-row (131px)** | correct |
| Inside a padder that is no part (`Inset`) | nothing leaves the padder, **but the row is not drawn at all** (seen in the screenshot; its box collapses) | **row steps 8px out of the padder**, unless the padder resets (then correct) |
| A bare string as a child | wrong track unless the part boxes it (it does) | correct |
| Below Chrome 117 (no subgrid; the floor is 111) | every grouping part behaves as "plain wrapper" above | correct |

**The evidence disagrees with the brief here.** "Nothing cancels a parent's padding" is the cleaner idea, and it fails in ordinary code: wrappers between a region and a part are everywhere (every slot contribution, every component with a root element). The second mechanism fails in one place only, and that place can be closed at the top rung: all 80 inline padding utilities are declared in `app.css`, so each can carry the reset. Then a padder that does not reset has no spelling short of raw CSS.

**Recommended: pad and step out, with the reset inside every inline padding utility and every scroller primitive.** It is the rail reduced to what holds: one kind of payer (surfaces), two variables instead of ten, no followers, no applied / owed accounting, no text rail.

Not measured, and required before a pilot: a nested scroller that is not a region (`Scroll`, base-ui `ScrollArea`); wide content inside a `Full`; a classic (non-overlay) scrollbar; sticky children; virtualized rows; right-to-left.

### The parts (closed list, v1: frozen before the held-out test)

The held-out test changed this list; see "Coverage of the held-out prototypes" for v1.1.

Surfaces own their edges and bars. Their regions are slots (props), so feature code never renders a region it could misplace.

| Surface | Slots | Evidence |
|---|---|---|
| **Pane** | `header` (exists: title and actions from `Pane.define`), `toolbar` (0..n bars), `lead` (one edge-to-edge block: hero, banner), body, `footer`. Body `layout`: `flow` \| `reading` \| `fill` | 82 bar prototypes; 58 strip sites; 107 panes |
| **Panel** | `header`, `search`, body, `footer`. One anatomy for popover, menu, dialog, sheet, drawer, sidebar, floating panel; the host changes skin and position only | popover 40, menu 35, sheet 14, dialog 10; 12 `padding="none"` disables |
| **Card** | `header` (title, actions, collapsible), `media`, body, `footer` | 79 prototypes; 71 + 53 sites |

Content parts go in any body, at any depth.

| Part | Sits on | Props | Evidence |
|---|---|---|---|
| **Section** | label on `text`; adds no inset | label, count, actions, collapsible | 69 prototypes; 92 sites |
| **Row** (in **Rows**) | box on `fill`, content on `text` | icon, hint, trailing, selected, onSelect | 80 prototypes |
| **Facts** | label and value on `text`, optional rules on `edge` | items, ruled | about 25 prototypes; 27 sites |
| **Rule** | `edge` | none | full-width dividers; 73 band disables |
| **Full** | `edge` | none | 8 bleeding media / table prototypes |
| **Strip** | box on `edge`, content starts on `text`, scrolls sideways | none | 44 prototypes |
| **State** | `text`, or centred | tone, centred | 61 prototypes; 59 sites |
| **Callout** | `text` | tone, actions | 14 prototypes; 16 sites |

**Size.** v1: 11 parts, 30 props beside `children` (Pane 4 new: `toolbar`, `lead`, `footer`, `layout`; Panel 3; Card 5: title, actions, collapsible, `media`, `footer`; Section 4; Row 5; Facts 2; Rule, Full, Strip 0; State 2; Callout 2; the table above lists them). v1.1: 14 parts, about 38 props. None is a spacing prop or `className`. Row is the one part the held-out test showed to be cut wrong (five variants asked of it); v1.1 splits it.

Record lists stay `DataView` / `DataTable`: they sit on `edge` and their cells keep the `text` gutter.

### Page archetypes are recipes, not components

This is where the evidence disagrees with the brief. The app's 107 non-Debug panes and the prototypes' archetypes all reduce to a body `layout` plus parts:

| Archetype | Panes | Recipe |
|---|---|---|
| Record list | 31 | Pane `fill` + DataView |
| Detail | 27 | Pane `flow` + Sections (+ Facts) |
| Canvas | 20 | Pane `fill` + the canvas; floating Panels |
| Reading column | 10 | Pane `reading` |
| Dashboard 5, card grid 4 | 9 | Pane `flow` + `Grid` of Cards |
| Chat 2, form 2 | 4 | Pane `reading` + `footer` composer; Pane `flow` + control panel |
| Hero / landing | 5 | not covered: marketing bands stay local to the website |

Nine archetype components would add nine names and no behaviour. Each archetype is instead one exhibit (an executable recipe an agent copies) and one paragraph in the css skill.

### Three layers

1. **Anatomy**: the parts above. Shared, in `primitives/css/surface-parts` (Pane's slots in `primitives/pane`).
2. **Skin**: tokens per surface kind in the density group, overridden per app theme. Most exist today and keep their values: `documentPadX`, `popoverPad`, `panelPad`, `padRowX`, `padCard`, `sidebarRail`.
3. **Declared local parts**: a component an app (or umbrella) writes for a shape the list lacks. Its file is listed in the plugin's own `exempt/index.ts` (`kind: "sanctioned"`, reason `local part: <name>`), the existing mechanism, so `./equin exempt list` is the census. The page editor's `Block` is the first.

**Promotion rule.** A shape in one app is a local part. The same shape declared in two apps is reported as a candidate by a check; at three it must be promoted or merged into an existing part.

Prototypes stay free: nothing here constrains them.

### Enforcement

**This departs from the brief in one place: `gap` stays for now.** Gap is 2076 props, has one owner by construction (the container) and was never the source of a misplacement. Parts own the rhythm between blocks, which removes most vertical `Stack`s in bodies. The pilot counts what is left before deciding.

| Rung | What it covers |
|---|---|
| 1. Inexpressible | Parts take no `className` and no padding prop. Surface regions are slots, so feature code never renders a region. Panel hosts lose `padding` and `rows`; `PaneChrome` loses `inset`. Every inline padding utility resets the step-out distances. |
| 2. Type error | Slot and layout combinations that make no sense. |
| 3. Lint | `surface-parts/no-spacing-in-feature`: outside `plugins/primitives` and `plugins/ui`, no padding or margin class, no `rail-*`, no `<Inset>`, no `insetClass()`, no `padding` / `margin` in a `style` object, no padding in a plugin's own `.css` file. `No flaw:` a host element's `className` is a string TSX cannot type. |
| 4. Runtime | The layout harness's region kit, extended with the wrapper cases above, runs in every region of every surface. |

**Rung 1 covers the parts only.** `<div className="px-md">` still compiles in feature code; what refuses it is the lint, a guard. That is the honest ceiling while feature code can write host elements.

What the lint needs to be worth having:

- **Debt that only shrinks.** Unmigrated plugins carry debt entries in their own `exempt/index.ts` (the existing mechanism), generated once: 340 files hold padding classes, about 420 once `<Inset>`, margins (49 uses) and rail classes are included. A check refuses a debt entry for this rule that the merge base does not have.
- **A census that is not buried.** There are already 430 `sanctioned` entries in the repo. Local parts need a kind of their own (`local-part`), not a reason prefix.
- **Slot contributions.** A contribution is feature code and is linted where it is written; the lint does not need to see where it lands.

The 2026-11-09 doc rejected a blanket ban for three reasons. Each is answered: the exempt files are a debt list that burns down by app (the ban means something only in migrated apps); `no-adhoc-spacing`'s message stops pointing at `<Inset>`; and there is no pad prop left to push people towards.

### What happens to the rail

It becomes a private detail of primitives, then shrinks to the recommended mechanism. It is not removed outright: the measurement above says stepping out of a padded region is the mechanism that survives real code, and that is the rail's core.

1. **Private at once.** The lint bans `rail-*` in feature code (about 70 uses become debt entries).
2. **Compatible while both exist.** A region under the recommended mechanism is, in today's terms, a paid region (`rail-<step>`: rail = the `text` distance, owed 0), so an unmigrated child behaves as it does in a document pane today: a `rail-follow` band adds nothing, a `rail-bleed` reaches the edge. A `Full` must republish (rail 0, owed = the `text` distance) so a DataView placed on `edge` keeps its gutter. **Unproven**: this needs an exhibit holding an unmigrated DataView and a `Loading` skeleton on both placements before the pilot.
3. **Reduced.** Once `data-view`, `data-table`, `Loading`, `Separator`, `menu-field`, `Placeholder` and `control-panel` use the parts' placements: delete followers (`rail-follow`, `rail-owe-*`), the owed and text-rail variables, `rail-band*`, `rail-text-indent`, the four lint rules and `useRailGuard`. What remains is two variables and the reset.

## The tests

### Coverage of the app

- **By screen:** 101 of 107 non-Debug panes (94%) match a recipe above. Leftovers: 5 hero / landing panes (website landing and download, Pages root, Home new-app, agent-manager welcome) and the Events root. **This is an upper bound**: it was judged from pane names and file signals, not from reading each body, and the held-out prototypes below show that misses appear at body level (a row that expands, a stacked footer), not at archetype level. Only a pilot gives the real number.
- **By site:** 59% of the 822 sites are owned by a part and 21% by an existing leaf primitive, so 80% with no escape. Another 9% is vertical rhythm, which the parts should absorb but which is not resolved until the gap decision. 8% need one declared local part (`Block`). The rest are indents and one-offs. All classifier figures, ±15%.

### Coverage of the held-out prototypes

Scored by a separate agent that saw only the frozen v1 list above and the 52 held-out prototypes, asked to find what does not fit. It read layout rules for all 52 and about 20 files closely; counts marked ~ are its estimates.

| | Result |
|---|---|
| In scope | 42 of 52 (out: 3 canvases, 2 screenshot galleries, 5 marketing / print pages) |
| Fully expressible with v1 | **18 of 42 (43%)** |
| Expressible only by adding a variant to a part | 7 more (60% cumulative) |
| Needs a local part | 17 |
| Distinct structures that map to a part without bending it | ~31 of ~48 (65%) |

**v1 fails the bar proposed below (80%).** What missed, by recurrence:

| Misfit | Prototypes | Reading |
|---|---|---|
| Meter, KPI, sparkline, chart inside a row or tile | 7 | Mostly an artefact: `Meter` exists and was missing from the leaf list given to the scorer. Charts are leaves, not spacing parts |
| Timeline / stepper with a node rail | 7 | Missing part (`setup-steps` covers steps only) |
| Footer made of several stacked strips (tray above a composer) | 4 | Pane `footer` must be 0..n like `toolbar` |
| Row that expands into a body aligned on its **label** | 4 | Missing part, and a missing line (below). The app shows it too: the 22 "indent" sites |
| Handle or gutter hung outside `text` | 4 | A placement between `fill` and `text` in a reading layout |
| Multi-line page header 4, header floating over the body 4 | 8 | Pane header variants; `PaneChrome` already has the floating one |
| Bordered multi-line option rows | 3 | Missing part. The app has 44 such sites, filed above under leaves |
| Tabs or a toolbar in a Panel | 3 | Panel needs `toolbar` like Pane; `search` is one kind of toolbar |
| Pane `lead` | 0-1 uses | Not earned: remove |

Row was the suspect cut: it needed five variants (expandable, depth, bordered option, inline meter, drag gutter).

**The edges.** The 13 hover-fill bleeds and the 4 edge bleeds in the held-out set all map to `fill` and `edge`. Three things do not:

- **A fourth line.** Content under a row aligns on the row's label, past its icon column (3 prototypes; the control-panel studies name the rail themselves: `--cp-rail-icon`, `--cp-rail-text`). `text` is not enough where rows have a lead cell.
- **Depth** (tree indent, nested blocks) is data per instance, not a token.
- **The `fill` distance varies inside one surface** in 3 prototypes (5, 6, 10px). A skin makes it one value per surface; that normalises what the prototype drew.

Vertical overlaps (a head pulled 18px over a hero) are not edges at all and stay inside the part that draws them.

#### v1.1, changed by this test and not validated by it

| Change | Why |
|---|---|
| Every surface has the same bars: `header`, `toolbar` (0..n), body, `footer` (0..n). Panel's `search` is a toolbar; Pane's `lead` is removed | Footer stacks 4, Panel toolbars 3, `lead` unused |
| A fourth, row-local line `label`: a Rows group whose rows have a lead cell gives its children the line after that cell | The expandable-row misfits |
| New part **Disclosure**: a row that opens a body on `label` | 4 held-out; 22 app sites |
| New part **Option**: a bordered, multi-line choice row | 3 held-out; 44 app sites |
| New part **Timeline** (steps or events on a node rail) | 7 held-out; 6 design-set prototypes |
| Row keeps lead / label / hint / trailing; `depth` stays with the tree primitive | Row's five variants |

That is 14 parts. Rescoring the same 42 by hand gives about 23 fully expressible (55%), but the set is now spent: this number is in-sample. The next test needs prototypes nobody has looked at, which means the ones made after today.

**Two readings of 43%, and I cannot choose between them from this data.**

- *The cut is wrong.* Row needed five variants, an edge was missing, Panel lacked a toolbar. A better list would score much higher.
- *Prototypes outrun any closed list.* A third of the misses are components being explored for the first time (timelines, query builders, steppers); prototypes are free by decision.

The app figure does not settle it: 94% is judged from pane names and is an upper bound, while 43% is measured from bodies. They are not comparable.

**What I would require before trusting v1.1:**

1. v1.1 frozen in this doc (done above) and the `label` edge built in the exhibit (not done).
2. A blind score on prototypes made after 2026-11-27, by an agent given the full leaf list (`Meter`, `setup-steps`, charts).
3. Twenty real app panes read in full and scored at body level, to replace the 94%.
4. A kill number, fixed now: if v1.1 fully expresses fewer than 60% of the new prototypes, or fewer than 80% of the twenty panes, the list is recut before any app migrates.

### Trap list

`plugins/primitives/plugins/css/plugins/surface-parts` holds a working `Panel` (the searchable menu family) and five exhibits measured by `./equin check layout-geometry`: `menu`, `traps`, `traps-pad`, `wrappers`, `wrappers-pad`.

The traps exhibits write each of the rail doc's three traps the way it was hit. What is measured, for both mechanisms, at 262px and 360px:

| Trap (rail/CLAUDE.md) | Attempt | Measured |
|---|---|---|
| Nested followers each pay | A label, a State and a Row three Sections deep | Label, state and row text at 12px; row box at 4px. No inset accumulates |
| A bleed under a box that pads without publishing overhangs it | A Rule and a Row inside an `Inset` | Lines: both boxes start at the padder's content edge (and the row collapses, see above). Pad: the same **only when the padder resets**; under today's `Inset` the row steps 8px out (`wrappers-pad`, recorded as a known miss) |
| A bleed inside a both-axis scroller buys sideways scroll | The body scrolls on both axes; a Full, a Rule and a Row | Left edges at 0 / 0 / 4px; the Full and the Rule end at the panel's right edge; nothing leaves the panel |

The check has teeth: giving a Section an 8px inline padding (a group that pays, the old shape) fails `traps`.

**What this does and does not prove.**

- Trap 1 cannot be written with parts under either mechanism: no part that groups pays.
- Trap 2 is closed under the recommended mechanism only once the padding utilities carry the reset. That is designed, not built; the exhibit shows both states.
- Trap 3 is shown for a region that is its own scroller, with overlay scrollbars and content narrower than the region. A nested scroller that is not a region has to reset as well, and is not measured. Wide content in a `Full` scrolls the region sideways by design; the rules then end at the viewport width.
- One family, element children, two widths. Pane and Card are designed, not built.
- Left edges are distances from a probe at the panel's edge; right edges use `pinnedRight` at the widest width. The harness has no edge-to-edge invariant.
- The header, body and footer are three regions with equal distances. They agree on the left; with a classic scrollbar the body's right edges move in by its width and the bars' do not.

Screenshots caught what the geometry check could not, twice: the first build drew a body of zero height, and under lines a row inside an `Inset` is not drawn (every measured x was still right). Geometry assertions here are about x only; each exhibit was also looked at (`exhibit-shot.ts --id surface-parts/<name>`).

### What to count after the pilot

| Count | Reads as |
|---|---|
| Local parts declared in the app | More than 4, or two alike: a part is missing |
| `Full` uses per surface | More than 2: a part is missing |
| Props or variants added to a part during the pilot | More than one on any part: wrong cut |
| Lint exemptions left in the app | Target 0; each one listed with its reason |
| Parts found stepping out of a box that did not reset | Any: a padder or scroller escaped the reset |
| `Stack gap` uses left, and distinct steps per part | Decides whether gap joins the ban |
| Review rounds per screen | Was 3-4; target 1 |
| Screens neutral / improved / worse | The user's call, from before/after pairs |
| Fidelity eval, arm A against B | Once that harness exists |

## Migration

1. **Build the parts, change no app.** The reset in the padding utilities and scroller primitives; Pane slots and layouts, Panel, Card, the content parts; the rail compatibility exhibit (an unmigrated DataView and `Loading` on both placements); the unmeasured cases of "Two mechanisms, measured"; one exhibit per recipe; the lint rule with generated debt entries. The four requirements of the held-out section run here.
2. **Pilot: Places**, as the brief names it. 40 sites, 7 band disables, floating panels over a map. Six parts absorb about 34 of its 42 sites (panel header / body / footer / state 13, card body and footer 5, callout 5, facts 4, rows 4, media pill 3). **Places is a weak pilot on its own**: it has one pane, a map, so it exercises Panel and Card only, the family already built, and none of what the review found risky (pane bodies, DataView, slot contributions, the rail compatibility).
3. **Second pilot: Tasks** (25 sites; list, detail, DataViews, and a detail pane built from slot contributions). Open decision 6.
4. **App by app**, small first: backup, build, events, review, settings and config, tasks, plugin-studio, deploy, prototypes, file-explorer, mail, pages and page (`Block`), chord, sonata, stats (onto `DataTable`), conversations (141 sites, the transcript cards), shell and desktop chrome, website. **Debug last**, with no visual check.
5. **Primitives off the rail**, then delete it.

Each app migration ships with before/after pairs; a diff must be neutral or better.

**How slices 1-3 are absorbed.** They stay on main and become the first implementation behind the parts; the tokens keep their values, so the renames are zero-diff.

| On main | Becomes |
|---|---|
| `OverlayPanel` `header` / `footer` | Panel slots |
| `OverlayPanel` `padding`, `rows` | gone: every Panel has the three edges |
| `menu-field` room | Panel `search` slot |
| `Column inset` / `rules` (2 users) | Panel in a docked host |
| `Band` (2 feature users), `Separator bleed` | surface bars, Rule |
| `PaneChrome inset="document"` (15 feature files) / `"content"` / `"chrome"` | `layout="flow"` / a skin token / `layout="fill"` |
| `PaneMessage` (70 uses), `Placeholder` (148 feature uses) | State |
| The pane edge (`documentPadX`) | the Pane skin's `text` inset |
| 3 rail lint rules, 85 disables | the one rule; disables leave with each app |
| Debt tasks task-1794239361-kagy27, task-1794490549-cbyqt4 | closed by the migration (reading columns are `layout="reading"`) |

## Open decisions

**No visual decision is asked now.** Every skin token keeps today's value for its host, so building the parts changes no pixel. Four visual questions are latent and will be put to the user as before/after pairs, or as prototype variants where there is a choice, when the pilot reaches them: one `fill` distance per surface where a screen draws several; inset pill or edge-to-edge row fill per surface kind; whether popover, dialog, sheet and sidebar really share one skin shape; the rhythm between sections.

1. **Mechanism.** Pad and step out with resets (recommended, on the measurements), or lines.
2. **Coverage that is good enough.** Proposed kill numbers: v1.1 fully expresses at least 60% of prototypes made after today and at least 80% of twenty app panes read in full; and in the pilot, at most one local part per screen. The first draft proposed 80% of held-out prototypes; v1 scored 43%, and I am lowering that bar to 60% for v1.1 because I cannot tell the two readings above apart. That is a judgement, not a result: say if 80% should stand.
3. **Gap.** Keep `Stack gap` and decide after the pilot (recommended), or ban it now as the brief says.
4. **Archetypes as recipes and exhibits** (recommended), or as components.
5. **Hero and landing pages** (5 panes, 5 held-out prototypes) are left to local parts of the website. Confirm, or ask for a marketing-band part.
6. **Pilots.** Places then Tasks (recommended), Places alone, or another pair.
7. **Home of the parts.** `primitives/css/surface-parts` was created under the css umbrella for the exhibit. Confirm, or name another home.
8. **Leaf work** (table cells onto `DataTable`, media pills, code boxes: about 125 sites). Part of this effort, or separate tasks (recommended).
9. **Promotion threshold.** Candidate at two apps, mandatory at three (recommended).
10. **`data-geo` on parts.** The exhibit's parts forward one attribute for the geometry harness. Keep it as the parts' only pass-through (recommended), or measure through children only.

## Verification (of a later implementation)

- `./equin check layout-geometry`: every part exhibit, the region kit in every body, the traps exhibit.
- `./equin exempt list`: the debt count falls by the migrated app's entries and nothing else.
- Per app: before/after pairs registered with `register_before_after`; the counts of "What to count after the pilot".

## Review findings

An independent agent reviewed the first draft and the exhibit, checked the counts against the repo, and reasoned about the CSS. What changed:

| Finding | Change |
|---|---|
| Under lines, a bare string or a child of a `display: contents` wrapper lands in the first 4px track; a part outside the grid displaces its own label | Confirmed by measurement (`surface-parts/wrappers`). A second mechanism was built and measured beside it; the recommendation moved to it |
| The trap table claimed more than the exhibit measured | Rewritten as what is measured, with a list of what is not |
| The rail compatibility publication cannot serve a child on `text` and a child on `edge` with one set of variables | A `Full` republishes; the claim is marked unproven and gated on an exhibit |
| Replacing the failed 80% threshold with a looser rate was goalpost-moving | Both readings stated; four requirements and kill numbers set; the lowered bar is now an explicit open decision |
| The lint is rung 3, with holes (style objects, a plugin's own CSS, no ratchet, census buried among 430 sanctioned entries) | Said so; the holes are in the rule's scope; debt can only shrink; local parts get their own kind |
| Places exercises only the family already built | Said so; Tasks proposed as second pilot; raised as a decision |
| "None of these is visual" was wrong | Replaced by the latent visual questions and when they will be shown |
| Counts off (variables 9 → 10, `inset="document"` files 20 → 15, margins uncounted, 340 files untraceable) | Corrected in place |

Not acted on: the reviewer could not run a browser, so its CSS findings were predictions; the wrapper exhibits now measure them.
