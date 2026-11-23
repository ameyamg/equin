import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { RelativeTime } from "@plugins/primitives/plugins/relative-time/web";
import type { RowAction, RowActionElement } from "../slots";

/**
 * Draws one row action — the ONLY place a transcript row action gets a look.
 * Every button is the same `IconButton`: the cluster sizes it (xs) and tones
 * it (muted at rest), and behind the `⋯` it becomes a labelled row. The
 * return type is the brand a contribution's component must return, so this is
 * the one way to make one.
 */
export function rowAction(action: RowAction | null): RowActionElement | null {
  if (action === null) return null;
  // The brand's one mint: the element IS a `RowActionView`.
  return (<RowActionView action={action} />) as RowActionElement;
}

function RowActionView({ action }: { action: RowAction }) {
  if (action.kind === "time") {
    const date = new Date(action.at);
    if (Number.isNaN(date.getTime())) return null;
    return (
      <span
        title={date.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      >
        <RelativeTime date={date} className="tabular-nums text-2xs" />
      </span>
    );
  }
  const button = (
    <IconButton
      icon={action.icon}
      label={action.label}
      active={action.active}
      disabled={action.disabled}
      onClick={action.onClick}
    />
  );
  return action.popup ? action.popup(button) : button;
}
