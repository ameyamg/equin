import type { SortRule } from "../../core";
import { splitPinned } from "./pinned-sort";

/**
 * Header-click reconciliation: cycle the PRIMARY sort rule for `fieldId`
 * against the existing multi-level rule list, so the header path and the sort
 * builder share one source of truth (never diverge). Pure + immutable.
 *
 * The primary is the first USER rule — pinned rules (a prefix, see
 * `pinned-sort.ts`) always stay in front and are never displaced:
 *
 *   - field is pinned                → that pinned rule's direction flips (a
 *                                       header never silently deletes a pin)
 *   - field is already primary, asc  → primary becomes desc (secondary kept)
 *   - field is already primary, desc → primary dropped (secondary promoted up)
 *   - field is absent or secondary   → promoted to primary asc, any existing
 *                                       rule for it removed from its old slot
 */
export function cyclePrimarySort(
  rules: SortRule[],
  fieldId: string,
): SortRule[] {
  const { pinned, user } = splitPinned(rules);
  if (pinned.some((r) => r.fieldId === fieldId)) {
    return [
      ...pinned.map((r) =>
        r.fieldId === fieldId
          ? {
              ...r,
              direction:
                r.direction === "asc" ? ("desc" as const) : ("asc" as const),
            }
          : r,
      ),
      ...user,
    ];
  }
  const primary = user[0];
  if (primary?.fieldId === fieldId) {
    return primary.direction === "asc"
      ? [...pinned, { fieldId, direction: "desc" }, ...user.slice(1)]
      : [...pinned, ...user.slice(1)];
  }
  return [
    ...pinned,
    { fieldId, direction: "asc" },
    ...user.filter((r) => r.fieldId !== fieldId),
  ];
}

/**
 * A column menu's Sort ascending / Sort descending: `fieldId` becomes the
 * PRIMARY sort in `direction`, any existing rule for it removed from its old
 * slot, the secondary rules kept in order. A pinned field keeps its place
 * among the pins and takes the direction (a header never displaces a pin).
 * Pure + immutable.
 */
export function setPrimarySort(
  rules: readonly SortRule[],
  fieldId: string,
  direction: "asc" | "desc",
): SortRule[] {
  const { pinned, user } = splitPinned(rules);
  if (pinned.some((r) => r.fieldId === fieldId)) {
    return [
      ...pinned.map((r) => (r.fieldId === fieldId ? { ...r, direction } : r)),
      ...user,
    ];
  }
  return [
    ...pinned,
    { fieldId, direction },
    ...user.filter((r) => r.fieldId !== fieldId),
  ];
}
