# Data table: resizable, stable columns

Prototype: `proto-1795190664-xuy4xa` (shown as the full page and as the Dependencies card in a task detail pane).

## Context

Today the DataView table:

- has no way to resize a column;
- squeezes the title (`minmax(0,1fr)`, floored only at the width of its header label);
- **drops trailing columns one by one as its box narrows** (`ColumnDef.dropOrder` → `useColumnFit` / `fitAlignedColumns`), so columns appear and disappear while the pane is resized;
- inside a card (a non-`base` `Surface`, e.g. the task detail's Dependencies section) has no sideways scroller at all, so dropping is its only fallback.

The user wants Notion's model, and reviewed it in the prototype:

1. Every column has a width. The user sets it by dragging the right edge of its header (double-click fits it to content), and it is stored per view.
2. **Columns never drop.** If the columns are wider than the box, the table scrolls sideways. This holds in a card too.
3. The title takes the spare room, but never shrinks below its width (`minmax(<w>px, 1fr)`).
4. **Nothing is sticky by default.** Clicking a header opens the column's menu: Sort ascending, Sort descending, Freeze up to here / Unfreeze columns, Fit to content, Hide.

## Design

### `data-table` (primitive), `plugins/primitives/plugins/data-table`

- **Widths.** New controlled props:
  - `columnWidths?: Readonly<Record<string, number>>` (px per column id);
  - `onColumnResize?(columnId, px)`.
  - A column with a stored width gets the track `${px}px`. A column with the new flag `ColumnDef.grow` gets `minmax(${px}px, 1fr)`.
  - Without a stored width, the track is `ColumnDef.width`, as today.
  - `onColumnResize` present → every header gets a resize grip on its right edge:
    - pointer capture;
    - live width during the drag (local state, one commit on release);
    - a full-height accent line at the edge;
    - a px badge during the drag;
    - a floor of `max(label, 48px)`.
  - Double-click on the grip fits the column: the widest rendered cell content in the column plus the header label, measured from the DOM, then `onColumnResize`.
  - Reuse the drag recipe of `layouts/miller/web/components/resize-handle.tsx` (pointer capture, dx, `lostpointercapture`). If it can be made generic without coupling, lift it into a shared primitive instead of copying it.
- **No dropping.** Delete `ColumnDef.dropOrder` and the `drop` mode of `useColumnFit`.
  - `fitAlignedColumns` stays in `data-table/core`, because the list view (`use-slot-widths.ts`) still uses it with `stacked`. Removing the list view's own drop is out of scope.
  - `trackMin` / `floorAtLabel` stay only if the sideways mode still needs them.
- **Sideways scroll everywhere.** A grid table that is not inside a `SidewaysScroll` region (inside a card, popover or plain box) wraps its grid in its own `overflow-x: auto` box, so it scrolls inside its card. The existing `Scroll`-hosted path (`useScrollsSideways`, `data-scrolls-x`) stays for tables in a page scroller, because it keeps the toolbar pinned. `presentation: "outline"` (sidebar trees) keeps squeezing, as now.
- **Freeze.** Replace the always-on `pinLead` with `frozenColumns?: number` (default **0**).
  - Columns `< n` are `<Sticky edge="left">`, each at the summed rendered width of the columns before it. The offsets are measured from the header cells in a layout effect and written as CSS vars on the grid, never as per-render state on every row.
  - The last frozen column gets the edge shadow once scrolled.
  - Generalise the existing lead-cell opacity, row-tint and rail-bleed styling (`LEAD_EDGE`, `LEAD_CELL`, `--dt-row-tint`) from "column 0" to "frozen columns".
  - Full-span bands (`PinToView`) keep pinning left whenever the table can scroll sideways.
- **Column menu.** New optional prop `columnMenu?: { onSort?(id, "asc" | "desc"); onFreeze?(columnId | null); onHide?(id) }`.
  - When it is present, a header click opens a `DropdownMenu` (ui-kit) anchored on the header. The items are:
    - Sort ascending, Sort descending (the current direction is checked from `sortState`; shown only when the column is sortable);
    - Freeze up to here, or Unfreeze columns when this column is the last frozen one;
    - Fit to content (when resizable);
    - Hide.
  - When it is absent, a header click sorts, as today, so the other ~30 `DataTable` callers do not change.

### DataView table view, `plugins/primitives/plugins/data-view` (+ `plugins/table`)

- **Persisted state.** These keys are stored on the view row, the same `{ type, …options }` variant value as `columnCaptions`. Both are additive and optional, so no migration is needed. Both are read in `TableViewOptions` and not exposed in `configSchema`:
  - `columnWidths: Record<fieldId, px>`;
  - `frozenUpTo: fieldId`. A field id, not a count, so the freeze survives hiding and reordering columns.
- **New render props** on `DataViewRenderProps`, wired in `data-view-body.tsx` over the model's existing writers:
  - `updateViewOptions(patch)` → `updateView(activeId, patch, { merge: true })`;
  - `setSortDirection(fieldId, dir)` → a pure `setPrimarySort(rules, id, dir)` next to `cyclePrimarySort` in `sort-cycle.ts`, written with `setSortRules`;
  - `hideField(fieldId)` → the same full-list write that `usePropertiesController.toggle` does. Share that helper; do not copy it.
- **`table-view.tsx` and `nested-table-view.tsx`:**
  - pass `columnWidths`, `onColumnResize` (→ `updateViewOptions({ columnWidths: {...} })`), `frozenColumns` (the index of `frozenUpTo` among the shown columns + 1, else 0) and `columnMenu`;
  - give the title column `grow: true` and a default width of 280px (nested: the tree label column, same);
  - drop the `dropOrder` mapping. `dropOrderOf` stays for the list view.
- Update `data-view/CLAUDE.md` (view config row keys, Placement, Table view options), `table/CLAUDE.md`, and `data-table/CLAUDE.md` ("Wide tables", which becomes "Widths, sideways scroll, frozen columns").

## Critical files

- `plugins/primitives/plugins/data-table/web/internal/{types.ts,data-table.tsx,use-column-fit.ts}`, `data-table/CLAUDE.md`
- `plugins/primitives/plugins/data-view/core/internal/types.ts` (`DataViewRenderProps`)
- `plugins/primitives/plugins/data-view/web/components/data-view-body.tsx`, `web/internal/{use-data-view-model.ts,sort-cycle.ts,use-properties-controller.ts}`
- `plugins/primitives/plugins/data-view/plugins/table/{core/internal/types.ts,web/components/table-view.tsx,web/components/nested-table-view.tsx}`
- Tests:
  - `data-view/plugins/table/web/__tests__/*` (hand-built props, and `header-sort.test.tsx`: a click now opens the menu, then "Sort ascending" calls `setSortDirection`);
  - `data-view/web/internal/sort-cycle.test.ts` (new `setPrimarySort` cases);
  - new data-table tests for widths, freeze and the menu.
- e2e: `data-view/plugins/table/e2e/sticky-scroll.ts` now asserts the opposite of the new rules ("nothing sticky by default", "a card table scrolls"). Rewrite it to cover: drag resize, no drop on narrowing, a card that scrolls, freeze.

## Verification

1. `./equin check` and `./equin test plugins/primitives/plugins/data-table plugins/primitives/plugins/data-view`.
2. `./equin build`, then the `browser_*` tools on the task detail page (the Dependencies card) and `/agents/tasks` in table view:
   - drag a header edge → the width persists after a reload;
   - narrow the pane → no column disappears and the table scrolls sideways;
   - header menu → sort asc / desc, freeze (sticks while scrolled), hide (the column comes back from Properties), fit.
3. Run the rewritten `sticky-scroll.ts` e2e.
4. `register_before_after` for the task detail and the tasks table.
