import type { AvatarColor } from "@plugins/primitives/plugins/avatar/core";
import {
  Avatar,
  AvatarPresentationProvider,
} from "@plugins/primitives/plugins/avatar/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import type { SymbolRef } from "@plugins/ui/plugins/icons/core";

/**
 * The one icon tile a companion panel's row leads with: a glyph on a gradient
 * squircle of one categorical colour, at the rows' 28px. Every section's row
 * (a page action, Record, …) draws its tile through this, so tiles share one
 * size, shape, gradient and glyph share in every section and companion.
 */
export function PanelTile({
  symbol,
  color,
}: {
  symbol: SymbolRef;
  color: AvatarColor;
}) {
  return (
    <span className={cn("block size-7", rigidClass())}>
      <AvatarPresentationProvider value="gradient-tile">
        <Avatar symbol={symbol} color={color} shape="squircle" />
      </AvatarPresentationProvider>
    </span>
  );
}
