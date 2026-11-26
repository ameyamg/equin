import type { ReactNode } from "react";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Icon } from "@plugins/ui/plugins/icons/web";
import type { ViewInstance } from "../../core";

/**
 * A view's glyph, wherever a view is drawn (the list, the chip strip, the
 * collapsed chip and its menu): its colour as a dot in the icon's box when it
 * has one (`ViewInstance.color` — a mail label), else its icon. ONE component,
 * so no switcher can draw a coloured view by its icon.
 *
 * `className` sizes and inks the box the way it would an `Icon`; the dot sits
 * centred in it.
 */
export function ViewGlyph({
  view,
  className,
}: {
  view: Pick<ViewInstance, "icon" | "color">;
  className?: string;
}): ReactNode {
  if (view.color === undefined) {
    return <Icon icon={view.icon} className={className} />;
  }
  return (
    <Center axis="both" className={cn("size-4", className)} aria-hidden>
      <span
        className="size-2.5 rounded-full"
        style={{ backgroundColor: view.color }}
      />
    </Center>
  );
}
