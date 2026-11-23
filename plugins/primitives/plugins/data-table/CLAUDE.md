# data-table

`DataTable` declares compact (`xs`) control density by default, so badges in cells and row-action buttons render at the smallest tier. Overridable via the `controlSize` prop.

## Row inset: the ambient rail

Every subgrid row — the column header, each data row, each `col-span-full` group
header — carries `py-row rail-follow`: block padding from the row density token
(`--pad-row-y`), inline padding from the ambient rail
(`var(--rail-start, var(--chrome-pad-x))`). There is no per-table opt-out, and
column alignment holds for the same reason the old fixed padding worked: every
row reads the _same_ value.

The default resolves to `--chrome-pad-x` (0.75rem), so a table
in a plain pane looks unchanged. A table inside a host that opened a rail region
(any `detail-sections` card body, the app-shell sidebar) follows that host's rail
instead — which is the point: the table stops being the one band that ignores it.

**In a region that already PAID its rail** (a `PaneChrome inset="document"`
body, a `detail-sections` card body — `rail-<step>` / `rail-document` owe
nothing), a follower would pay 0 and the rows would sit flush on the rail with
no gutter for their fills. So a grid / outline table's box cancels what its
region paid (`REGION_BLEED`: a negative inline margin of rail − owed, to the
region's edge, published as `--dt-bleed-*`) and its grid hands it back as
owed (`REGION_OWED`). In the grid look (`data-table.css`, `dt-grid`) the grid
then pads itself by the bleed and every full-span row takes the same negative
margin: a subgrid row's margin and padding add to its edge cells' margins, so
the -bleed and the row's +rail cancel there and **no column moves or narrows**
— rows, rules, fills and the frozen cells span the region, text on the
rail. (Paying the rail on the row alone takes it out of the first and last
tracks: Studio's fixed 2rem `#` column lost 16px and wrapped its label.) A
grid table bleeding in a CLOSED region (`--rail-edge: closed` — a section card
body, ending at the card's edge) draws no rule under its last row: edge to edge
right above the region's block padding it would read as an empty row. In an
OPEN region (`rail-document`: a pane body that runs on past the table) the
closing rule stays (a container style query on the registered
`--dt-bleed-start` and on `--rail-edge`). An outline row is a pill on the rail
(its own margin), so it takes only the owed rail. Under a `rail-owe-` owner or
with no region the paid amount is 0 and nothing changes. The owed half sits on
the grid, not the box: declared on the box it would be what the box's own
margin reads. A soft table keeps its own frame (`SOFT_BOX`).

`density="compact"` swaps `py-row` for `py-row-compact` (the `padRowCompactY`
density token) on every subgrid row — still one value for all rows, so
alignment holds.

## Column labels: header row or first group

`columnHeader` (default `"row"`) places the column labels. `"row"` is the sticky
header row. `"first-group"` (grouped mode only) renders no header row: the first
group's sticky band becomes a `grid-cols-subgrid` row (`data-slot=
"data-table-first-group-header"`) whose first cell holds the caller's header node
spanning the leading tracks up to the first column with a non-empty `header`,
followed by the remaining columns' label cells (sortable, same text style as the
header row) and the actions track's empty span. Group headers then pin at
`stickyHeaderOffset` rather than below a header row. It falls back to `"row"`
when ungrouped or when the first column is itself labelled. A column whose
`header` is absent or `""` is unlabelled: its header cell is empty.

## Per-row actions

`DataTableProps.rowActions?(row, index)` renders trailing per-row actions. The
grid template gains a trailing `auto` track (with an empty header span) and the
cluster renders into it through **`primitives/row-actions`**, which owns the
reveal, the guards and the sizing — each row carries `rowActionsAnchor`, the
cluster is `<RowActions pin={null} className="justify-end">`. Additive and inert
for consumers that don't pass `rowActions`.

`pin={null}` (in flow, not overlaid) is deliberate: a table column is genuine
flow, an overlaying cluster would cover the last column's data, and a
content-sized track is already a stable menu anchor. `rowActionsAnchor` bundles
`relative` — that is what the decoration overlay pins against, and it is inert on
undecorated rows (`z-index` stays `auto`).

`rowPersistentActions?(row, index)` is the twin cluster that stays painted **at
rest** (`alwaysVisible`), for an affordance important enough to be visible
without hovering. It shares the SAME trailing track, sitting immediately before
the revealed cluster — which is why, when both are present, the two are wrapped
in one flow child: a subgrid row has no implicit tracks, so a second direct child
would be clamped into the last track and paint on top of the first. The track is
reserved when either is present; with only `rowActions` the row is byte-identical
to before.

## Footer rows

`DataTableProps.footer` (ungrouped) and `DataTableGroup.footer` (per group,
hidden with the group's rows when `collapsed`) render one caller-owned
`col-span-full` row after the body — data-view's fold line lives there. A table
or group with a footer is content, so `emptyLabel` is not shown for it even when
it has no rows.

## Windowing

Above `DATA_TABLE_VIRTUALIZE_THRESHOLD` (100) rows the body windows
through the shared `useVirtualRows`. Unlike `VirtualRows`, the slice renders in
**normal grid flow** — the outer grid owns the column tracks and every row is a
`grid-cols-subgrid` span, so absolutely positioning rows would break alignment.
Off-screen height is instead reserved by `col-span-full` spacers, **one per gap**
in the rendered index sequence (leading, trailing, and any interior hole). Grouped
mode (`groups`) windows **per group**: each group's run of rows past the threshold
is its own windowed body (`bodySegments`), while every header and footer stays
mounted — grouping is the outer structure, windowing the inner one, so
`StickyStack` can always measure the headers. Each run's `useVirtualRows`
measures its own `scrollMargin` (and re-measures as the boxes above it resize),
so several windows share one scroller. Debug → Icons' matrix (≈350 rows × 5
icon columns in a few groups) mounted every cell before this — ~1,800 `<Icon>`s
per render.
The windowed body's first commit draws the hook's `probe` row (one real row, measured before
paint) so the window never starts from the `ROW_ESTIMATE` guess: a table that
crosses the threshold while scrolled would otherwise shift its visible rows
by the guess's error.

The threshold is exported because a drag-reordering consumer must know whether the
body windows, to decide whether its `RankReorderProvider` needs `measuringAlways`.

## Fold motion

The body is one flat list of lines (`bodyLines`: each group's header, rows
and footer, or the plain rows), run through `virtual-rows/row-fold`'s
`useRowFold` with the grid as host — plain, grouped and windowed bodies alike.
A group's `collapsed` flip folds its rows in or out (the table tracks it in
its own open set, keyed by the header line); a host disclosure folds through
`openKeys` (the nested table's expanded ids, data-view's open fold lines).
Every line's outermost element carries `rowProps` — rows, full-span lines,
group headers, footers — so the lines below a fold slide with it.

## Presentation: grid, outline or soft

`presentation` (default `"grid"`) is how the table looks. `grid` is the header
row, a hairline under every row (`border-b border-border/30`), a faint hover
tint and an accent fill on the selected row, and the sideways behaviour
below. `outline` is a sidebar's look: no header row (nor first-group labels;
group headers pin at `stickyHeaderOffset`), no row rules, and each row is the
tree row's rounded pill — `hover:bg-accent` on a row that is not selected, and
the `--selected` tier on the selected one (`text-selected-foreground`,
publishing `--scrim` and `--row-meta` like `Row` / `TreeRowChrome`). All looks
live in one `ROW_LOOK` table in `data-table.tsx`.

**`soft`** is borderless rows sized by the DataView token group
(`ui/tokens/data-view`, every metric a token): each row `min-h-soft-row
p-soft-row rounded-soft-row`, hovered to `--soft-row-hover-fill` (through
`--dt-row-tint`, like grid), and a hairline BETWEEN rows — the row's
`::before` on its top edge, drawn only under another soft row
(`[data-soft-row]`), from `softRuleStart`, hidden on the hovered row and the
row after it. One header row (`h-soft-header mb-soft-header`, no rule; its
labels as in every look, below). Cells take the `cell` pick (`rolePickScope`
on the row, `rolePickClass(fallback, false)` on each cell). The table's
box is the optional frame (`rounded-soft-frame p-soft-frame shadow-soft-frame
bg-soft-frame-fill border-soft-frame-border`, all none by default, an
inline-size container) and sits ON the rail as a margin; the grid inside sets
`--rail-owed-*: 0px`, so rows, group bands and footers pay no rail again. Wider
than its box it scrolls sideways like a grid table (no frozen columns: a soft
row pads itself); a revealed cluster takes the trailing track as in grid. The
windowed body's first estimate is 48px (`softRowH`'s default). The grid and
outline looks are untouched by it.

**Column labels, every look** (grid, outline, soft, first-group): no
hard-coded type — the band carries `rolePickScope(DATA_VIEW_PICKS.columnHeader)`
and each label `rolePickClass(fallback, false)` (the full rung, not the `xs`
step), cased by `columnHeaderCase` (a style query), `tracking-column-header`,
`text-column-header-ink` (`-sorted-ink` on the sorted column and on a sortable
label's hover). The arrow follows `sortIcon` (style queries on the icon):
`hover` (default) shows only the sorted column's and reveals an unsorted one
on its label's hover (`group/column-header`), `sorted` never, `always` faint.
So every `DataTable` — Studio's, Debug's — takes the theme's look; the old
uppercase one is `columnHeaderCase: upper` + `sortIcon: always`.

`parts?: DataTableParts` stamps caller-named `data-part`s on the box, the
header row, each label, row and cell (data-view passes its part vocabulary,
for the part-metrics diff).

An outline row takes the tree row's geometry, so a nested outline table reads
as a tree: `min-h-tree-row`, `py-xs`, `text-body`, and the pill sits ON
the rail — the rail is the row's margin, its content padded `--space-xs` inside
the pill (`OUTLINE_INSET`; nested, only its trailing edge — the tree head pays
the lead inset inside its indent, as `TreeRowChrome` does), where a grid row
pays the rail as padding. Its
revealed action cluster overlays the row's trailing edge (`RowActions`' default
pin, masked by the row's `--scrim`) instead of reserving a track, as a tree
row's does — a sidebar's labels keep that width. A persistent cluster still
takes the track. A decoration may state a row's revealed actions itself
(`DataTableRowDecoration.actions`, in place of `rowActions(row)`); `null` mounts
no cluster on that row — a nested row with nothing to offer costs no hover
cluster (and no mount-time swap of one, which on a windowed list that remounts
rows read as a render loop).

**An outline with its labels** (`header: true`): the column-header row a file
listing wants over tree rows. It takes the outline rows' inset and a tree row's
height, a breath under its rule; every column after the first reads
as meta (`text-caption text-row-meta`). Its columns squeeze into a narrow box —
it never scrolls sideways. Nested,
`tree.headerLeading` puts the first label over the rows' labels (a depth-0
row's lead inset and disclosure slot).

## Nesting rows (`tree`)

`DataTable` never builds a tree. A caller whose rows nest flattens them itself
(the tree primitive's `useTreeModel().flat`) and passes the visible lines as
`data` (or as each group's `rows`), plus `tree: DataTableTree`:

- **`leading(row, cell)`** wraps the first column's cell in the row's tree head
  (indent, guides, disclosure). Its result is the grid item.
- **`fullSpan(row)`** draws a line as ONE `col-span-full` band instead of cells
  (a lazy placeholder child) — no decoration hook, no actions, no checkbox;
  `null` → an ordinary row. Windowed, the band is still measured.
- **`pillIndent(row)`** — in `outline`, how far the row's pill starts past
  the rail (a CSS length: the tree's per-depth `--tree-pill-indent`, which the
  Pages theme sets). The row's own start margin carries it, so the fill steps
  in with the depth as a `TreeRowChrome`'s does; the `leading` head then pays
  only the content's share of its indent.
- **`containerRef` / `onKeyDown`** — the keyboard host (`useTreeKeyboard`), on
  the grid, which takes `role="treegrid"` (its cells `role="gridcell"`).

Under `tree` the table keeps `data` in the order given: `useDataTable`'s
`keepOrder` turns its own sort and filter off (the sort state still paints the
header arrows; sorting is the caller's, within sibling groups). Everything else
about a nested row — its drag source and droppables, its gestures, its
`data-tree-*` / ARIA attributes, its drop zones — arrives through
`useRowDecoration`, the seam a flat table's drag reorder uses; a decoration's
`props` are spread last, so they replace the row's own `onClick` / `tabIndex`
when the caller passes no `rowActivation`. Its `provide` wraps everything inside
the row (cells, action clusters, overlay) in a context of the caller's — the
nested table publishes the tree row's controls there. It must add no DOM.
Absent `tree`, nothing changes.

## Checkbox multi-select (`selection`)

`selection: { actions? }` turns on the `multi-select` primitive over the rows:
the table mounts a `MultiSelectProvider` (the range order is the painted rows'
keys — a collapsed group's and a full-span line's excluded), a `SelectionBar`
above the grid, and a `SelectionCheckbox` ahead of each row's first cell —
inside the tree head when the rows nest, after the disclosure. The checkbox
reveals on the row's `group/row-actions` hover and stops its own press from
reaching the row (no activation, no drag start).

## Widths, sideways scroll, frozen columns

Notion's model (`research/2026-11-23-primitives-data-table-resizable-columns.md`):
every column has a width, columns never drop, and a table wider than its box
scrolls sideways.

- **Widths.** `columnWidths` (px by column id) is the caller's stored state: a
  column with one is laid out at exactly that width — `minmax(<w>px, 1fr)` when
  it `ColumnDef.grow`s (the title: it takes the spare room, never shrinking below
  its width); one without keeps its `width` track.
- **Resize.** `onColumnResize` present → every header but a `ColumnDef.fixed`
  one carries a grip straddling its right edge (`ColumnGrip`, movable's
  `useDragGesture`: capture at drag start, a 4px threshold so a press is still a
  click, the click a drag ends on swallowed). The column is drawn at its live
  width during the drag (local state — the grid template only; rows are not
  re-rendered), with a full-height accent line at its edge (also on grip hover)
  and a px badge; one `onColumnResize` on release. The floor is the header label,
  at least 48px. A double-click fits the column to its content: its track laid
  out as `max-content` for one synchronous read (`maxContentTrackPx` — the header
  label and every row in the DOM, whatever truncates them now).
- **No dropping.** There is no `dropOrder`. `fitAlignedColumns` stays in `core`
  only for the list view's trailing slots (`use-slot-widths.ts`).
- **Sideways scroll** (`useColumnFit`, `web/internal/use-column-fit.ts`) — a
  `grid` or `soft` table; an `outline` (a sidebar's tree) squeezes into its box:
  - In ui-kit's `SidewaysScroll` region (opened by a vertical `Scroll`, ended by
    every `Surface` but `base` and by `OverlayPanel`), with that `Scroll` the
    nearest box clipping it horizontally (a DOM walk), the **pane** scrolls: while
    the grid is wider, its box carries `data-scrolls-x`, which turns the `Scroll`
    into the sideways scroller (and an inline-size container), and `Scroll`'s CSS
    keeps everything but the table in place — the boxes on the path grow to it,
    everything off it (the DataView's toolbar, a stats band) pins `left: 0` at
    `max-width: 100cqi` (`css/scroll`'s CLAUDE.md). The toolbar stays put.
  - Anywhere else — a card, a popover, a plain box — the table's **own box**
    scrolls: `overflow-x: auto` only while the grid is wider than it (so a table
    that fits keeps its sticky header pinned to the page), and it publishes its
    visible width as `--dt-view-w` for the full-span bands. While it scrolls, the
    box is the sticky rows' scrollport, so they ignore `stickyHeaderOffset` (an
    offset meant for the page's scroller would push the header over the first
    rows) and no longer pin to the page vertically — the price of a card that
    scrolls sideways.
  - The grid is `min-width: min-content`, every header label `nowrap`, and a
    `minmax(0, …)` track floored at its measured label (`floorAtLabel`, measured
    once per column id) — so no column collapses below its label; past that the
    grid is wider than its box.
- **Frozen columns.** Nothing is sticky by default. `frozenColumns: n` (grid
  presentation only) pins columns `< n`: each header label and body cell is a
  `<Sticky edge="left" layer="base">` (`FrozenCell`), column 0 at 0 and column
  `i` at `var(--dt-frz-<i>)` — the summed width of the columns before it, read
  from the grid's resolved tracks in the fit's resize observer and written as
  CSS vars on the grid (never per-row state; a row receives only the count). A
  frozen cell is opaque — `--chrome-mask` under a `linear-gradient` of the row's
  own tint: a grid row paints its tint through `--dt-row-tint`
  (`[background-color:var(--dt-row-tint)]`; hover, selected and a decoration's
  `highlighted` set it), never a `bg-*` class, so the pinned cell follows every
  row state. It reaches over the column gap on its right (and column 0 over the
  row's rail inset) so nothing peeks past it. The last frozen column casts an
  edge shadow once scrolled (`dt-frozen-edge`, data-table.css): a scroll-driven
  animation on the nearest scroller's inline axis — no listener; an engine
  without scroll timelines draws none.
- **Column menu.** `columnMenu` present → a header click opens the column's
  menu (ui-kit `DropdownMenu`, the header cell its trigger): Sort ascending /
  descending (a sortable column; the current direction checked from
  `sortState`), Freeze up to here / Unfreeze columns (on the last frozen one;
  where the table can scroll sideways), Fit to content (a resizable column),
  Hide. Absent → a header click sorts, as it always did — every other
  `DataTable` caller is unchanged.
- **Full-span bands** — group headers (`left: 0`), group and table footers, a
  tree's placeholder lines — pin their content to the left edge at
  `max-width: var(--dt-view-w, 100cqi)` whenever the table scrolls sideways, so a
  label or a fold line stays readable however far the table scrolled.

Pinned by `data-view/plugins/table/e2e/sticky-scroll.ts` (Debug → Claude CLI
Calls in the pane's scroller, and a card table: resize + persistence, no drop on
narrowing, sideways scroll, freeze). Verified in Chromium only.

## Rows are memoized: every row prop must keep its identity

`DataTableRow` is `memo`: the body draws rows in a `.map`, where no compiler
memoizes an element per item, so without it every commit of the table (a
window scrolling a row in, a search narrowing the rows, a page landing)
re-rendered every drawn row and its cells — ~100 components a row; a Tasks
search keystroke rendered ~30,000. A row bails out only while each of its props
keeps its identity, so:

- a windowed row's measure ref (`measureRef`) is the virtualizer's one
  `measureElement`, and the fold's row props travel as `foldInert` (the row
  rebuilds `rowProps` from its own key);
- a row is handed its key (`rowId`), never its position: `useRowDecoration`,
  `rowActions` and `rowPersistentActions` are called with `(row, key)`, so a
  row whose neighbours came or went keeps its props. The selection arrives as
  a boolean (`selected`), so a new `selectedRowId` re-renders two rows. A
  WINDOWED row too: it carries its key (`virtualKeyProps`), which the window
  looks its index up by (`virtual-rows`), never a `data-index` — a row above
  that comes or goes re-renders none of the rows below it (pinned by
  `web/__tests__/windowed-row-memo.test.tsx`);
- the `row` objects themselves keep their identity while unchanged — a
  nesting caller hands the tree model's shared lines (tree CLAUDE.md, "A row
  re-renders only when something about IT changes");
- a caller's `columns`, `tree`, `rowActions`, `rowPersistentActions`,
  `rowActivation` and `useRowDecoration` must be stable while what they draw is
  — never rebuilt per render. A decoration hook is a module constant reading
  its inputs from a context (data-view's nested table: `NestedRowContext`),
  never a function declared inside the caller's component (that is a new hook
  per render, and it keeps the React Compiler off the whole component).
  What changes per render (a section map, aggregate counts, which line is
  first) goes in that context as a `LatestStore` read per row
  (`primitives/latest-ref`), never as a value.

`render-cost.ts` (`framework/tooling/react-compiler/skips/e2e`) counts what a
step renders, to check a caller.

## Windowing + drag reorder compose

`useRowDecoration` (the per-row hook seam that `data-view/table` uses to mount
`useRankReorderItem`) does **not** disable windowing. Two things make that work:

- **`keepMountedRowKeys`** — pass the active drag id while a drag is in flight.
  It reaches `useVirtualRows`' `keepMounted`, which forces the row's index into
  the rendered range. Without it, scrolling the source out of the window unmounts
  its draggable and dnd-kit cancels the drop. A pinned row is a non-contiguous
  index — hence the one-spacer-per-gap layout above, which renders it at its true
  offset (far off-screen, so it neither paints nor collides).
- **the composed row ref** — a windowed decorated row is simultaneously a drag
  source and a virtualizer measurement target, so `DataTableRow` merges the
  decoration ref and the measure ref into one callback ref.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: Sortable/filterable flex-layout data table primitive.
- Web:
  - Uses: 38 symbols — full list in [REFERENCE.md](./REFERENCE.md)
    - `primitives/css/ui-kit` ×11
    - `primitives/css/sticky/stack` ×3
    - `primitives/css/text` ×3
    - `primitives/multi-select` ×3
    - `primitives/css/sticky` ×2
    - `primitives/dom/element-size` ×2
    - `primitives/link-gesture` ×2
    - `primitives/row-actions` ×2
    - `primitives/virtual-rows/row-fold` ×2
    - `primitives/virtual-rows` ×2
    - `primitives/css/center.Center`
    - `primitives/css/scroll.useScrollsSideways`
    - `primitives/css/spacing.Stack`
    - `primitives/css/z-layers.zLayerClass`
    - `primitives/dom/movable.useDragGesture`
    - `ui/icons.Icon`
  - Exports (types):
    - `ColumnDef`
    - `DataTableColumnMenu`
    - `DataTableGroup`
    - `DataTableParts`
    - `DataTablePresentation`
    - `DataTableProps`
    - `DataTableRowDecoration`
    - `DataTableSelection`
    - `DataTableTree`
    - `SortState`
  - Exports (values):
    - `DATA_TABLE_VIRTUALIZE_THRESHOLD`
    - `DataTable`
- Cross-plugin:
  - Uses tokens: 48 vars — full list in [REFERENCE.md](./REFERENCE.md)
    - `ui/tokens/data-view` ×23
    - `ui/tokens/color-palette` ×8
    - `ui/tokens/density` ×7
    - `ui/tokens/type-scale` ×7
    - `ui/tokens/shape` ×2
    - `ui/tokens/font-family --letter-spacing`
  - Imported by:
    - `apps/plugin-studio/contributions`
    - `apps/plugin-studio/contributions/tables/columns`
    - `apps/plugin-studio/contributions/tables/foreign-keys`
    - `apps/plugin-studio/contributions/tables/indexes`
    - `apps/plugin-studio/contributions/tables/sample-rows`
    - `conversations/conversation-view/jsonl-viewer/tool-call/query-db`
    - `conversations/conversation-view/jsonl-viewer/tool-call/runtime-profile`
    - `conversations/conversation-view/jsonl-viewer/tool-call/timeline`
    - `conversations/launch-timeline`
    - `debug/boot-profile`
    - `debug/heap-snapshot`
    - `debug/profiling/boot`
    - `primitives/data-view/list`
    - `primitives/data-view/table`
    - `primitives/metrics/chart-kit`
- Exemptions:
  - Exempts itself from: `react-compiler:no-silent-skips` — `web/internal/data-table.tsx` (debt)
- Core:
  - Exports (types):
    - `FitColumn`
    - `TrackMin`
  - Exports (values):
    - `fitAlignedColumns`
    - `floorAtLabel`
    - `trackMin`

<!-- AUTOGENERATED:END -->
