import type { SortRule } from "../../core";

/**
 * Which way a grouped field's sections read: the view's own sort on that
 * field; with no sort at all, the direction the rows arrive in — a live
 * source's collection default order on the field's column (a mail list's
 * `date` desc reads Today first); else ascending. The ONE answer for the
 * sections a live source reads and the buckets the body draws.
 */
export function groupDirection(
  sort: readonly SortRule[],
  fieldId: string,
  defaultOrder:
    | {
        orderBy: readonly (readonly [string, "asc" | "desc"])[];
        column: string;
      }
    | undefined,
): "asc" | "desc" {
  const own = sort.find((r) => r.fieldId === fieldId)?.direction;
  if (own !== undefined) return own;
  if (sort.length === 0 && defaultOrder !== undefined) {
    const d = defaultOrder.orderBy.find(
      ([c]) => c === defaultOrder.column,
    )?.[1];
    if (d !== undefined) return d;
  }
  return "asc";
}
