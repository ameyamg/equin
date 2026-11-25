import type { RefObject } from "react";

export type ParsedCombo = {
  mod: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
};

export type ShortcutDescriptor = {
  id: string;
  keys: string;
  label: string;
  group?: string;
  handler: () => void;
  /**
   * Eligibility gate, evaluated on the keystroke that matched. The event is
   * passed so a shortcut can decide from WHERE the key landed (`event.target`)
   * — e.g. undo yielding to a text field that keeps its own history. Most
   * guards ignore it and read their own state.
   */
  when?: (event: KeyboardEvent) => boolean;
  /**
   * Which handler wins when several eligible shortcuts match ONE keystroke
   * (`Escape` while a tour and edit mode are both live): the highest
   * precedence fires, alone. Default 0. Not an order of anything drawn.
   */
  precedence?: number;
  /**
   * Fire even when an editable element (input/textarea/select/contenteditable)
   * is focused. Off by default: plain-key shortcuts yield to the text field so
   * the keystroke is typed. Modifier combos (Cmd/Ctrl/Alt+…) always fire
   * regardless of this flag. Set true only for a plain-key shortcut that must
   * win inside inputs.
   */
  enableInInputs?: boolean;
  /**
   * If set, this shortcut is eligible only when its surface is the focused
   * surface; unset = global, always eligible.
   */
  surfaceId?: string;
  /**
   * The part of the surface this shortcut belongs to — a list, a panel — for
   * a key several mounted instances of one component bind on one surface (two
   * lists stepping with j / k, two Submit bars on ⌘↵). Among the eligible
   * regioned shortcuts matching a keystroke, the one whose region holds the
   * key fires; the others never do. See {@link ShortcutRegion}.
   */
  region?: ShortcutRegion;
};

/**
 * Where a regioned shortcut's key belongs (`ShortcutDescriptor.region`).
 * Among the regioned shortcuts matching one keystroke, the manager keeps:
 *
 * 1. those whose `root` holds focus (contains the key event's target — or,
 *    when that target is a container around the last press, the pressed
 *    element: the body after a click on unfocusable text, a page block's
 *    caret host around the block pressed in);
 * 2. else, when `pointer` is set, those whose `root` is under the pointer;
 * 3. else the one regioned shortcut, when it is alone on its key (nothing to
 *    tell apart — the region is the surface's only one).
 *
 * A region nested in another one holding the key wins over it. Two regions
 * left after that, or none, fire nothing: a key is never handed to a region
 * by guess. A region whose root is not mounted holds no key.
 */
export interface ShortcutRegion {
  root: RefObject<Element | null>;
  /**
   * Whether the pointer over `root` claims the key while no region holds
   * focus. Off for a key whose wrong guess costs (⌘↵ sending answers): only
   * focus decides it.
   */
  pointer: boolean;
}
