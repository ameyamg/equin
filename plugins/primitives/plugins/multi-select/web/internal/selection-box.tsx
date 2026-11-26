import type { ReactElement } from "react";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { useMultiSelectItem } from "./use-multi-select-item";

export type SelectionBoxProps = {
  /** The item this box checks (one of the provider's `orderedIds`). */
  id: string;
  /** Accessible name — what checking the box selects. */
  label?: string;
  /** The reveal a host composes on the box (it is always drawn otherwise). */
  className?: string;
};

const checkIcon = symbol("check");

/**
 * A drawn checkbox for one item of a `MultiSelectProvider`: a 16px rounded
 * square, outlined while unchecked, filled with the primary colour and a check
 * while checked. A `role="checkbox"` button, so it can sit beside (never
 * inside) a row's own control. Its press is its own: the click and the
 * pointer-down stop at the box, so they neither activate the row nor arm its
 * drag. Shift-click adds the span from the anchor (the reducer's `TOGGLE`).
 *
 * Where `SelectionCheckbox` is the native input (a dense table cell), this is
 * the box a list draws in its rows' leading slot — over an avatar, or in a
 * slot of its own.
 */
export function SelectionBox({
  id,
  label = "Select",
  className,
}: SelectionBoxProps): ReactElement {
  const { isSelected, toggle } = useMultiSelectItem(id);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isSelected}
      aria-label={label}
      data-selection-box=""
      onClick={toggle}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "block size-4 rounded-checkbox border transition-[opacity,background-color,border-color]",
        isSelected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/60 bg-background hover:border-foreground",
        className,
      )}
    >
      <Center as="span" axis="both" className="size-full">
        {isSelected ? <Icon icon={checkIcon} className="size-3" /> : null}
      </Center>
    </button>
  );
}
