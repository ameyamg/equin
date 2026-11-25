import type { AvatarColor } from "@plugins/primitives/plugins/avatar/core";
import type { SymbolRef } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import "../internal/panel-tile.css";

/**
 * The one icon tile a companion panel's row leads with: a glyph on a squircle
 * of one categorical colour, lit from the top-left, at the rows' 28px. Every
 * section's row (a page action, Record, …) draws its tile through this, so
 * tiles share one size, shape, shade and glyph size in every section and
 * companion.
 */
export function PanelTile({
  symbol,
  color,
}: {
  symbol: SymbolRef;
  color: AvatarColor;
}) {
  return (
    <span className="panel-tile" data-color={color}>
      <Icon icon={symbol} />
    </span>
  );
}
