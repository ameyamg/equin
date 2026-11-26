import { Scroll, type ScrollProps } from "@plugins/primitives/plugins/css/plugins/scroll/web";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { KeepScrollScope } from "@plugins/primitives/plugins/dom/plugins/auto-scroll/web";
import { usePaneInstanceKey } from "../pane";

/**
 * `PaneScroll` props mirror `Scroll` minus the two axes the pane body fixes:
 * `axis` (always `"y"`) and `fill` (always on, so the viewport claims the pane's
 * leftover height and the overflow engages), and `keep` (the pane body is kept
 * under its own name). Everything else — `hideScrollbar`, `isolate`, `as`,
 * `ref`, `className`, `children` — forwards straight through.
 */
export type PaneScrollProps = Omit<ScrollProps, "axis" | "fill" | "keep">;

/**
 * The single sanctioned pane-body vertical scroll viewport — a dead-thin
 * `<Scroll axis="y" fill h-full>`. A pane body is exactly one `PaneScroll`; every
 * header inside it is a `<Sticky>`. Routing every pane body through this one idiom
 * makes "the pane owns exactly one scroll" a grep/doc target and keeps
 * `VirtualRows.findScrollParent` binding to a predictable viewport.
 *
 * It opens the pane instance's keep scope (auto-scroll's `KeepScrollScope`,
 * keyed by tab, pane instance, address and views) and keeps its own offset in it across
 * a page reload, so a reloaded page opens where the reader left it. A body that
 * scrolls in a box of its own instead (a file preview, a code listing) keeps
 * that box by naming it: `<Scroll keep="…">` under this scope.
 *
 * It forwards `ref` (consumers may need the scroll-container element), `as`,
 * `hideScrollbar`, `isolate`, and composes `className` last.
 */
export function PaneScroll({ className, ...rest }: PaneScrollProps) {
  return (
    <KeepScrollScope scope={usePaneInstanceKey()}>
      <Scroll
        axis="y"
        fill
        keep="pane"
        className={cn("h-full", className)}
        {...rest}
      />
    </KeepScrollScope>
  );
}
