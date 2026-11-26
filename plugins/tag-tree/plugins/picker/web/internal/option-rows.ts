import type { FieldOption } from "@plugins/primitives/plugins/data-view/core";
import { Rank } from "@plugins/primitives/plugins/rank/core";
import type { TagPickerRow } from "./types";

/**
 * A field's option forest (`FieldOption.parent`, in the order the options
 * list it — a tag tree's `tagFieldOptions`) as rows a read-only picker draws:
 * each option a tag named by its label and coloured by its swatch, siblings in
 * the options' order. The inverse of `tagFieldOptions`, for an editor that has
 * the options and nothing else.
 */
export function tagRowsOfOptions(
  options: readonly FieldOption[],
): TagPickerRow[] {
  const values = new Set(options.map((o) => o.value));
  const ranks = Rank.nBetween(null, null, options.length);
  return options.map((o, i) => ({
    id: o.value,
    name: o.label,
    parentId: o.parent !== undefined && values.has(o.parent) ? o.parent : null,
    color: o.swatch ?? null,
    childColors: null,
    icon: null,
    rank: ranks[i]!.toString(),
  }));
}
