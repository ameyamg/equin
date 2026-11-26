# scroll

The scroll-container box. ~100 call sites re-derived `min-h-0 flex-1
overflow-y-auto` by hand; `<Scroll>` owns that combination as one role.

## Why overflow and fill are one concern

A scroll pane inside a flex column needs **both** `flex-1` (claim the leftover
main-axis space) **and** `min-h-0` (allow shrinking below intrinsic content
height, so the overflow actually engages). Ship only `flex-1` and the pane grows
to fit its content, pushing past the parent — the whole page scrolls instead of
the pane. So `fill` emits the pair together (`min-w-0 flex-1` on the `x` axis);
splitting `min-h-0` back out re-opens that footgun.

The perpendicular axis is clamped to `hidden` for `axis="y"`/`"x"` so a vertical
scroller never sprouts a stray horizontal bar.

**One exception, declared by the content:** a `y` scroller (marked
`data-scroll-x-host`, and opening ui-kit's `SidewaysScroll` region for its
children) also scrolls sideways — and is an inline-size container (`100cqi` =
what it shows) — while it holds an element marked `data-scrolls-x`. A grid
`DataTable` wider than its box declares itself so with `useScrollsSideways(box,
active)`, which marks the box `data-scrolls-x` and every box from its parent up
to the scroller (included) `data-scroll-x-path`; the scroller's own classes key
on that mark (`data-scroll-x-path:overflow-x-auto`). The pane then stays the ONE scroller on both axes, which is what
lets the table's sticky header (top) and sticky first column (left) pin to the
same scroller — a table scrolling inside a box of its own would capture the
header's `top`, and its group headers with it.

Only the table moves (`web/internal/scroll.css`, base layer, `:where` — any
class the element carries wins): every box on the path from the scroller to the
table grows to the table (`fit-content`, `min-width: 100%`), and every child of
a path box that is off the path — a stats band, the DataView's toolbar band, a
side panel — pins `left: 0` at `max-width: 100cqi`. A positioned child
(`absolute`, `relative`) keeps its position and scrolls instead. Unmarked,
nothing applies. See `data-table`'s CLAUDE.md ("Wide tables").

**The path is named by the table, never found by a `:has()`.** The first
version found it in CSS — `[data-scroll-x-host]:has([data-scrolls-x])
:has([data-scrolls-x])`. Its last compound is a bare `:has()`, so Chrome tests
it on every element in every pane, and any DOM insertion anywhere in a pane
(a fold mounting its content, a live row arriving) invalidated every ancestor's
whole subtree: a full restyle of a long transcript (~37k elements, 0.3–0.7 s)
between a click and the fold it started. The `css:no-unanchored-has` check
rejects that shape anywhere.

## Scope

Owns only overflow + the fill policy. **Sizing stays in `className`** — `h-*` /
`max-h-*` are not banned, so a fixed-height scroller is `<Scroll
className="max-h-96">` and a full-height one is `<Scroll className="h-full">`.

## Kept across a reload by default

A scroller's name in its keep scope is where it is written, and the build knows
that: `vite/index.ts` writes `keep={{ kind: "site", site:
"<repo file>#<Component>#<n>" }}` on every `<Scroll>` and `<Column>` imported
from their barrels and written with no `keep` (`n`: its place among that
component's stamped elements — so lines moving elsewhere in the file keep the
name). So forgetting to keep a scroller cannot be written; opting out is
`transient("<why>")`.

- **One site rendered more than once at a time in a scope** (a code block per
  row, a card per item) keeps nothing: its instances have nothing that tells
  them apart across a reload, and numbering them by mount order put one's
  offset into another once anything mounted, unmounted or moved. It keeps
  while one instance is live; a second makes every instance stand down for the
  rest of the document (`instances: "many"`, auto-scroll's `claimSharedKey`).
  Such a scroller that needs keeping is given a name of its own per row.
- **Inside a popup** (ui-kit's `OverlayPanel` and sheet provide
  `PopupSurface`) a call site keeps nothing: a reload never reopens a popup,
  and a picker's list restored to an old offset fought its search box. A
  written name still keeps.
- The stamp runs **before the React Compiler** (`order: -200`): the compiler
  outlines a capture-free `rows.map((r) => <Scroll/>)` callback into a
  module-level `_temp`, where the component it was written in is gone.

- Only the vertical offset is kept, so an `axis="x"` scroller keeps nothing
  by default.
- A stick-to-bottom follower (`useStickyScroll`) on the scroller: one that
  persists keeps the reader's row itself and the keep stands down; one that
  does not is kept by this keep — a parked reader's offset is saved, and a
  reload opens the follower parked there; a reader at the bottom saves nothing
  and still follows after the reload (auto-scroll's CLAUDE.md, "A follower
  decides who keeps its scroller").
- A spread after the stamp (`{...props}`) carrying `keep` overrides it, as a
  written one would.
- Tests run no build pass: there an unset `keep` keeps nothing; a test writes
  the `ScrollSite` itself.

Before (2026-11-26), keeping was opt-in by name, and each forgotten scroller
was found by the dev loss detector after it lost the reader's place (7
scrollers, 13 losses in two days).

## Props

- **`axis`** — `"y"` (default) | `"x"` | `"both"`.
- **`fill`** — emit the flex-child fill pair. Default false.
- **`hideScrollbar`** — `hide-scrollbar` (scrollable, no chrome). Default false.
- **`isolate`** — new stacking context (`isolate`). Default false.
- **`keep`** — how the offset fares across a page reload, within the
  enclosing keep scope (auto-scroll's `KeepScrollScope`; every pane opens
  one). **Leave it unset**: a vertical scroller is kept by default (above).
  A name (`keep="pane"`) keeps it under that name — unique in its scope, two
  live scrollers under one throw. `transient("<why>")` says its offset is
  throwaway by design. Outside a scope nothing is kept.
- **`as`** — host element. Default `div`. **`className`** composes last.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: Scroll-container layout primitive: <Scroll axis fill> owns overflow AND the flex-child fill policy (min-h-0 flex-1) as one role.
- Web:
  - Uses:
    - `primitives/css/ui-kit.cn`
    - `primitives/css/ui-kit.SidewaysScrollProvider`
    - `primitives/dom/auto-scroll.SCROLLER_ATTR`
    - `primitives/dom/auto-scroll.useKeptScroll`
    - `primitives/overlay/popup-open.useInPopupSurface`
  - Exports (types):
    - `ScrollAxis`
    - `ScrollKeep`
    - `ScrollProps`
  - Exports (values):
    - `Scroll`
    - `scrollClasses`
    - `useScrollsSideways`
- Cross-plugin:
  - Uses tokens: `ui/tokens/density --space-sm`
  - Imported by: 104 plugins — full list in [REFERENCE.md](./REFERENCE.md)
    - `conversations` ×30
    - `apps` ×22
    - `primitives` ×17
    - `debug` ×10
    - `page` ×5
    - `build` ×2
    - `companions` ×2
    - `config_v2` ×2
    - `infra` ×2
    - `plugin-meta` ×2
    - `review` ×2
    - `stats` ×2
    - `tasks` ×2
    - `code-explorer/file-resolve`
    - `fields/json/config`
    - `shell/notifications`
    - `ui/theme-engine/theme-gallery`
- Core:
  - Exports (types): `ScrollSite`

<!-- AUTOGENERATED:END -->
