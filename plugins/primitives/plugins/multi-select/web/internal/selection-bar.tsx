import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import type { ReactElement, ReactNode } from "react";
import { Sticky } from "@plugins/primitives/plugins/css/plugins/sticky/web";
import { Pin } from "@plugins/primitives/plugins/css/plugins/pin/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Surface } from "@plugins/primitives/plugins/css/plugins/surface/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { useMultiSelect } from "./use-multi-select";

export type SelectionBarProps = {
  actions?: ReactNode;
  /**
   * Where the bar floats while something is selected:
   * - `"top"` (default) — a strip pinned under the scroller's top edge
   *   ("N selected", Select all, Clear, the actions). Render it BEFORE the
   *   rows.
   * - `"bottom"` — a raised pill centred at the bottom of the scroller's
   *   viewport ("N selected", the actions, a divider, a clear ✕). Render it
   *   AFTER the rows: a bottom sticky sticks within the box it ends.
   */
  placement?: "top" | "bottom";
  className?: string;
};

const closeIcon = symbol("close");

export function SelectionBar({
  actions,
  placement = "top",
  className,
}: SelectionBarProps): ReactElement {
  return placement === "bottom" ? (
    <BottomBar actions={actions} className={className} />
  ) : (
    <TopBar actions={actions} className={className} />
  );
}

function TopBar({
  actions,
  className,
}: {
  actions: ReactNode;
  className: string | undefined;
}): ReactElement {
  const { selectedCount, isActive, selectAll, clearAll } = useMultiSelect();

  return (
    <Sticky edge="top" layer="float" className="h-0 w-full">
      <Pin
        to="top"
        offset="xs"
        layer="float"
        className={cn(
          "transition-[translate,opacity] duration-200",
          isActive
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-2 opacity-0",
        )}
      >
        <Stack
          direction="row"
          align="center"
          gap="sm"
          className={cn(
            "whitespace-nowrap rounded-lg border bg-background/95 px-lg py-sm text-body shadow-lg backdrop-blur",
            className,
          )}
        >
          <span className="font-medium text-foreground">
            {selectedCount} selected
          </span>
          <button
            type="button"
            onClick={selectAll}
            className="text-muted-foreground hover:text-foreground"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
          {actions && (
            <>
              <div className="bg-border h-4 w-px" />
              <Stack direction="row" align="center" gap="xs">
                {/* eslint-disable-next-line row-actions/no-raw-actions-slot -- bulk-selection bar actions, one per surface, not a per-row cluster */}
                {actions}
              </Stack>
            </>
          )}
        </Stack>
      </Pin>
    </Sticky>
  );
}

/**
 * The bottom pill: a zero-height anchor stuck to the scroller's bottom edge
 * (`Sticky edge="bottom"`), the card pinned above it — so it takes no layout
 * room and the rows never move for it. It fades and slides up in while
 * something is selected, and is inert (click-through, out of the tab order)
 * while nothing is.
 */
function BottomBar({
  actions,
  className,
}: {
  actions: ReactNode;
  className: string | undefined;
}): ReactElement {
  const { selectedCount, isActive, clearAll } = useMultiSelect();
  return (
    <Sticky edge="bottom" layer="float" className="h-0 w-full">
      <Pin
        to="bottom"
        layer="float"
        inert={!isActive}
        data-selection-bar="bottom"
        className={cn(
          "transition-[translate,opacity] duration-200",
          isActive
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-2 opacity-0",
        )}
      >
        {/* The overlay surface (a floating panel): its border, ground,
            radius and shadow are the theme's; it moves with the pin. */}
        <Surface
          level="overlay"
          motion={false}
          className={cn(
            "rounded-selection-bar mb-selection-bar-lift",
            className,
          )}
        >
          <Stack
            direction="row"
            align="center"
            gap="sm"
            role="toolbar"
            aria-label="Selection"
            // The controls in the muted ink, brightening under the pointer
            // (a ghost IconButton hovers to the text colour): the count reads
            // first.
            className="whitespace-nowrap py-selection-bar pr-xs pl-lg text-body text-muted-foreground"
          >
            <span className="font-medium text-foreground">
              {selectedCount} selected
            </span>
            {actions ? (
              <Stack direction="row" align="center" gap="2xs">
                {/* eslint-disable-next-line row-actions/no-raw-actions-slot -- bulk-selection bar actions, one per surface, not a per-row cluster */}
                {actions}
              </Stack>
            ) : null}
            <div className="bg-border h-4 w-px" />
            <IconButton
              icon={closeIcon}
              label="Clear selection"
              onClick={clearAll}
            />
          </Stack>
        </Surface>
      </Pin>
    </Sticky>
  );
}
