import { Fragment, type ReactElement, type ReactNode } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Separator,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import type { IconRef } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import {
  MenuItemForm,
  PanelRowsForm,
  useActionForm,
} from "../internal/action-form";

/** Offered so a bar that relocates the menu hands it `"row"` (see `formFor`). */
const ACTION_MENU_LADDER = { shrinksTo: ["row"] } as const;

export interface ActionMenuProps {
  /** The trigger's accessible name and tooltip ("Page actions"). */
  label: string;
  /** The trigger's glyph (`more-horiz` for a "⋯"). */
  icon: IconRef;
  /**
   * The entries in groups, a rule drawn between consecutive groups (a menu
   * separator inline, a hairline between the panel's rows). Each entry is an
   * action that offers the `"menu-item"` and `"row"` rungs (an `IconButton`).
   */
  groups: readonly ReactNode[];
}

/**
 * An icon-triggered menu of actions (a "⋯") that never nests inside another
 * one. Inline, it is a dropdown whose entries draw themselves as menu items
 * (`MenuItemForm`). Once an adaptive bar relocates it into its overflow panel
 * — itself a "⋯" — the trigger is gone and its entries ARE the panel's rows
 * (`PanelRowsForm`): a menu inside a menu was one more click and a popup
 * opening out of a popup for the same actions.
 *
 * So the entries must be actions that render themselves in both forms — an
 * `IconButton` — never a raw `DropdownMenuItem`, which has no menu to live in
 * once the menu is the panel.
 */
export function ActionMenu({
  label,
  icon,
  groups,
}: ActionMenuProps): ReactElement {
  const form = useActionForm(ACTION_MENU_LADDER);
  if (form === "row") {
    return (
      <PanelRowsForm>
        {groups.map((group, i) => (
          <Fragment key={i}>
            {i > 0 && <Separator bleed />}
            {group}
          </Fragment>
        ))}
      </PanelRowsForm>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            aspect="icon"
            aria-label={label}
            tooltip={label}
          />
        }
      >
        <Icon icon={icon} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <MenuItemForm>
          {groups.map((group, i) => (
            <Fragment key={i}>
              {i > 0 && <DropdownMenuSeparator />}
              {group}
            </Fragment>
          ))}
        </MenuItemForm>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
