import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import "./tips-bulb.css";

const lightbulbIcon = symbol("lightbulb");

/**
 * The tips' mark: a lit lightbulb in its own warm light
 * (`--website-tip-light`, declared once in `tips-bulb.css`), glowing. The
 * tips page's heading opens with it; the Download page's Learn the tricks
 * card wears it in its tile. Sized by the caller.
 */
export function TipsBulb({ className }: { className?: string }) {
  return (
    <Icon
      icon={lightbulbIcon}
      active
      aria-hidden
      className={cn("website-tips-bulb", className)}
    />
  );
}
