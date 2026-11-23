import { defineRenderSlot } from "@plugins/primitives/plugins/slot-render/web";
import type { ComponentType, ReactElement, ReactNode } from "react";
import type { JsonlEvent } from "@plugins/conversations/plugins/transcript-source/core";
import type { IconRef } from "@plugins/ui/plugins/icons/core";

/**
 * What one row action IS, as data — never how it is drawn. The strip draws
 * every `button` as the same `IconButton` (size from the cluster, tone from
 * the cluster), so no contributor can give its action a look of its own: the
 * drift this replaced was copy/investigate/change-answers on a hand-rolled
 * `size-5` muted button beside `IconButton`s inheriting the prose colour.
 */
export type RowAction =
  | {
      kind: "button";
      icon: IconRef;
      /** The action's name: its tooltip, accessible name, and its row text behind the `⋯`. */
      label: string;
      /** An on toggle (the icon's active form). */
      active?: boolean;
      disabled?: boolean;
      onClick?: () => void;
      /**
       * For an action that opens something (a popover, a menu, a launch
       * popover): place the strip's own button as that popup's trigger. The
       * button is drawn by the strip and handed in — the popup is yours, the
       * button is not.
       */
      popup?: (trigger: ReactElement) => ReactNode;
    }
  /** When the event happened: a relative time, absolute on hover. */
  | { kind: "time"; at: string };

declare const rowActionBrand: unique symbol;

/**
 * The only thing a row action's component may return: an action drawn by
 * `rowAction(…)`. Branded, so a component returning its own `<button>` /
 * `<Button>` is a type error — the look is the strip's, never the
 * contributor's.
 */
export type RowActionElement = ReactElement & {
  readonly [rowActionBrand]: true;
};

export interface RowActionContribution {
  id: string;
  /**
   * Reads what it needs (its own hooks, called before any gate) and returns
   * `rowAction(action)` — or `rowAction(null)` / `null` when this event
   * carries no such action.
   */
  component: ComponentType<{ event: JsonlEvent }> &
    ((props: { event: JsonlEvent }) => RowActionElement | null);
}

export const JsonlRowActions = {
  Item: defineRenderSlot<RowActionContribution>({ docLabel: (p) => p.id }),
};
