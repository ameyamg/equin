import { useRef, useState, type CSSProperties } from "react";
import { useResizeObserver } from "@plugins/primitives/plugins/dom/plugins/element-size/web";
import { useScrollsSideways } from "@plugins/primitives/plugins/css/plugins/scroll/web";
import { floorAtLabel } from "../../core";

/** The narrowest the first column of a NESTED table gets — the tree's own
 *  label floor, so a deep row keeps a readable name (past it the table
 *  scrolls sideways). */
export const NESTED_LEAD_MIN_PX = 160;

/**
 * What the table may do when its columns are wider than its box. `sideways`:
 * scroll sideways — every column keeps its width, the narrowest a column gets
 * is its header label (a grid or soft table). `none`: squeeze every column
 * into the box (an outline — a sidebar's tree).
 */
export type ColumnFitMode = "sideways" | "none";

/**
 * Who scrolls a sideways table. `page`: the pane's own `Scroll` (the table sits
 * in ui-kit's `SidewaysScroll` region, and that `Scroll` is the nearest box
 * clipping it horizontally) — it then scrolls on both axes, so the sticky
 * header and the frozen columns pin to the same edges, and the DataView's
 * toolbar stays put (`css/scroll`). `own`: anywhere else (a card, a popover, a
 * plain box), the table's own box scrolls sideways while the grid is wider.
 */
export type SidewaysScroller = "page" | "own";

/** What the fit reads off the laid-out table, once per resize. */
interface Room {
  scroller: SidewaysScroller;
  /** What the grid can have before it overflows. */
  available: number;
  /** The grid's own laid-out width — wider than `available` when it overflows. */
  grid: number;
  /** The measured header label of every column seen so far, by id. */
  measured: ReadonlyMap<string, number>;
  /** Where each frozen column pins, px from the scroller's left edge. */
  frozenLefts: readonly number[];
}

export interface ColumnFit {
  /** Who scrolls the table sideways once measured; `null` while it squeezes
   *  (`none`) or has not been measured yet. */
  scroller: SidewaysScroller | null;
  /** Each column's grid track (`floorAtLabel` once measured). */
  tracks: string[];
  /** The table box's own style while its box is the scroller: `overflow-x`
   *  while the grid is wider, and the visible width full-span bands pin to. */
  boxStyle: CSSProperties | undefined;
  /** The grid's style: each frozen column's pin offset as `--dt-frz-<i>`
   *  (`frozenLeftVar`), read by that column's sticky cells. */
  frozenStyle: CSSProperties | undefined;
  containerRef: (el: HTMLElement | null) => void;
  gridRef: (el: HTMLElement | null) => void;
}

/**
 * How a table lays its columns out when they are wider than its box. Nothing
 * ever drops: a `sideways` table floors each flexible track at its header
 * label (`floorAtLabel` — a `minmax(0, …)` column would otherwise collapse to
 * nothing) and scrolls — by its pane's `Scroll` (`data-scrolls-x`, see
 * `useScrollsSideways`) or by its own box (`overflow-x: auto`, only while the
 * grid is wider, so a table that fits keeps its sticky header pinned to the
 * page).
 *
 * A label is measured once per column id on its header cell (nowrap, so it is
 * the narrowest the grid lets that track be). Until measured — and in a box
 * with no layout (jsdom) — the tracks are the columns' own.
 */
export function useColumnFit(
  columns: readonly { id: string }[],
  baseTracks: readonly string[],
  opts: { mode: ColumnFitMode; inSidewaysRegion: boolean; frozen: number },
): ColumnFit {
  const { mode, inSidewaysRegion, frozen } = opts;
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [grid, setGrid] = useState<HTMLElement | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const measured = useRef(new Map<string, number>());
  const template = baseTracks.join(" ");
  const columnIds = columns.map((c) => c.id).join("\u0000");

  useResizeObserver(
    // The scroller too: once the table overflows a page scroller, its own box
    // no longer follows the pane, so a wider pane must still re-measure.
    () =>
      [container, grid, container && scrollerOf(container)].filter(
        (el): el is HTMLElement => !!el,
      ),
    () => {
      if (!container || !grid) return;
      if (mode === "none") {
        setRoom(null);
        return;
      }
      const box = container.getBoundingClientRect();
      // A box with no layout says nothing about the room.
      if (box.width === 0) return;
      const scroller: SidewaysScroller =
        inSidewaysRegion && sidewaysHost(container) ? "page" : "own";
      let available: number;
      if (scroller === "page") {
        // While the table overflows, the boxes around it grow to it (the
        // DataView root fits the table, so its band can pin), and so does this
        // one: the room is what the scroller shows to the right of the box's
        // start, whichever is narrower — both edges in the scroller's
        // UNSCROLLED frame (a sideways scroll moves the box, not the room).
        const pane = scrollerOf(container);
        const visible = pane
          ? pane.getBoundingClientRect().left +
            pane.clientLeft +
            pane.clientWidth -
            (box.left + pane.scrollLeft)
          : box.width;
        available = Math.min(box.width, visible);
      } else {
        // The box is the scroller: its content box is the room.
        const style = getComputedStyle(container);
        available =
          container.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight);
      }
      const header = grid.querySelector<HTMLElement>(
        "[data-slot='data-table-header']",
      );
      if (header) {
        for (const cell of header.querySelectorAll<HTMLElement>(
          "[data-column-id]",
        )) {
          const id = cell.dataset.columnId!;
          if (measured.current.has(id)) continue;
          // The label's own inline box: its width is the label's, whatever
          // the track does.
          measured.current.set(
            id,
            Math.ceil(cell.getBoundingClientRect().width),
          );
        }
      }
      const next: Room = {
        scroller,
        available,
        grid: grid.getBoundingClientRect().width,
        measured: new Map(measured.current),
        frozenLefts: frozen > 1 ? frozenLefts(grid, frozen) : [],
      };
      setRoom((prev) =>
        prev &&
        prev.scroller === next.scroller &&
        prev.available === next.available &&
        prev.grid === next.grid &&
        prev.measured.size === next.measured.size &&
        prev.frozenLefts.join() === next.frozenLefts.join()
          ? prev
          : next,
      );
    },
    // Before paint: a pane narrowing lays the table out at its floors in the
    // same frame, never one frame of collapsed columns first.
    {
      deps: [
        container,
        grid,
        mode,
        inSidewaysRegion,
        template,
        columnIds,
        frozen,
      ],
      beforePaint: true,
    },
  );

  const sidewaysRoom = mode === "sideways" ? room : null;
  const tracks = baseTracks.map((track, i) =>
    sidewaysRoom
      ? floorAtLabel(track, sidewaysRoom.measured.get(columns[i]!.id))
      : track,
  );
  const overflowing =
    !!sidewaysRoom && sidewaysRoom.grid > sidewaysRoom.available + 0.5;
  // In a page scroller, while the grid is wider its box marks itself and the
  // path up to the scroller: the `Scroll` then scrolls sideways too (and only
  // then), so the pane is the one scroller on both axes.
  useScrollsSideways(
    container,
    overflowing && sidewaysRoom.scroller === "page",
  );

  return {
    scroller: sidewaysRoom?.scroller ?? null,
    tracks,
    boxStyle:
      overflowing && sidewaysRoom.scroller === "own"
        ? ({
            overflowX: "auto",
            // What a full-span band pins to (`SPAN_PIN`): the box's visible
            // width — the box is no container (an inline-size container
            // contributes no width to a box sized by its content, a popover).
            "--dt-view-w": `${sidewaysRoom.available}px`,
          } as CSSProperties)
        : undefined,
    frozenStyle:
      sidewaysRoom && sidewaysRoom.frozenLefts.length > 0
        ? (Object.fromEntries(
            sidewaysRoom.frozenLefts.map((px, i) => [
              frozenLeftVar(i + 1),
              `${px}px`,
            ]),
          ) as CSSProperties)
        : undefined,
    containerRef: setContainer,
    gridRef: setGrid,
  };
}

/** The CSS var a frozen column's cells read their pin offset from (column 0
 *  pins at 0 and reads none). */
export function frozenLeftVar(column: number): string {
  return `--dt-frz-${column}`;
}

/**
 * Where frozen columns 1…n-1 pin: each at the summed width of the columns
 * before it, read from the grid's resolved tracks — never from the cells,
 * which a sideways scroll has already moved while they are pinned. Column 0's
 * cell reaches over its row's rail inset to the row's edge (`LEAD_EDGE`), so
 * its pinned box starts where the row does; every other column's cell starts
 * at its track, which sits the grid's start padding (the region bleed) plus
 * the tracks and gaps before it from the row's edge.
 */
function frozenLefts(grid: HTMLElement, frozen: number): number[] {
  const style = getComputedStyle(grid);
  const tracks = style.gridTemplateColumns.split(" ").map(parseFloat);
  const gap = parseFloat(style.columnGap) || 0;
  let x = parseFloat(style.paddingLeft) || 0;
  const out: number[] = [];
  for (let i = 1; i < frozen && i < tracks.length; i++) {
    x += (tracks[i - 1] ?? 0) + gap;
    out.push(Math.round(x));
  }
  return out;
}

/**
 * Whether the table sits in a box that may scroll it sideways: the nearest
 * ancestor that clips it horizontally is a scroll host (`Scroll` marks itself
 * `data-scroll-x-host`). A DOM walk, not a React context, because a context
 * crosses portals: a table in a popover opened from a pane is in the pane's
 * React tree but in the popover's box.
 */
function sidewaysHost(el: HTMLElement): boolean {
  for (let n = el.parentElement; n; n = n.parentElement) {
    if (getComputedStyle(n).overflowX !== "visible") {
      return n.hasAttribute("data-scroll-x-host");
    }
  }
  return false;
}

/** The nearest ancestor that scrolls vertically — the pane, which also scrolls
 *  sideways while a table overflows it (`Scroll`'s `data-scrolls-x` arm). */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const y = getComputedStyle(n).overflowY;
    if (y === "auto" || y === "scroll") return n;
  }
  return null;
}
