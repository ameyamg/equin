import { canonicalJson } from "@plugins/network/plugins/live/plugins/canonical-params/core";
import type { FilterGroup, FilterNode, FilterRule } from "../../core";
import { newNodeId } from "./filter-tree-ops";

/**
 * A view's LOCKED rules: its root's direct rules marked `locked` — the base of
 * what the view is (a mail view leaving spam and trash out), which no edit of
 * its filter can drop or change. Only a root `and`'s direct children count: a
 * locked rule anywhere else would constrain nothing the user cannot undo by
 * editing around it.
 */
export function lockedRules(filter: FilterGroup | null): FilterRule[] {
  if (filter === null || filter.conjunction !== "and") return [];
  return filter.children.filter(
    (n): n is FilterRule => n.kind === "rule" && n.locked === true,
  );
}

/**
 * The filter `next` with `prev`'s locked rules kept, whatever the edit that
 * made it — the ONE write path of a view's filter goes through it
 * (`useDataViewModel`'s `setFilter`), so a remove, a clear, a quick filter, a
 * preset or a chip's × cannot take one off, and an edit of one is dropped:
 *
 * - a locked rule `next` holds unchanged at its root stays where it is;
 * - every other node naming a locked rule's id (an edited copy, one moved into
 *   a group), or marked `locked` while `prev` has no such rule, is dropped — a
 *   locked rule is authored with the view, never by an edit;
 * - a locked rule `next` lacks goes back at its place in `prev`'s root, so an
 *   edit undone (add a rule, remove it) is the saved filter again, order and
 *   all;
 * - `next`'s root, when an `or`, is ANDed after them as a group of its own
 *   (with an id of its own).
 *
 * `drop` names locked rules the caller removes on purpose — only the repair of
 * a rule that no longer resolves (`removeUnavailableRules`), which would
 * otherwise leave the view refusing to render with no way out.
 *
 * `null` (no filter, or nothing left) only when no locked rule remains and
 * `next` is empty.
 */
export function keepLockedRules(
  prev: FilterGroup | null,
  next: FilterGroup | null,
  drop: ReadonlySet<string> = new Set(),
): FilterGroup | null {
  const locked = lockedRules(prev).filter((r) => !drop.has(r.id));
  const byId = new Map(locked.map((r) => [r.id, r]));
  const lockedIds = new Set(lockedRules(prev).map((r) => r.id));
  if (locked.length === 0) {
    return next === null ? null : stripLocked(next, lockedIds, new Set());
  }
  // The top-level locked rules `next` kept as they are.
  const kept = new Set<string>();
  if (next !== null && next.conjunction === "and") {
    for (const child of next.children) {
      const own = byId.get(child.id);
      if (own !== undefined && canonicalJson(child) === canonicalJson(own)) {
        kept.add(child.id);
      }
    }
  }
  const rest = next === null ? null : stripLocked(next, lockedIds, kept);
  const children: FilterNode[] =
    rest === null || rest.children.length === 0
      ? []
      : rest.conjunction === "and"
        ? [...rest.children]
        : [{ ...rest, id: newNodeId() }];
  // The locked rules the edit dropped, back at their place in `prev`.
  prev!.children.forEach((child, index) => {
    const own = byId.get(child.id);
    if (own === undefined || kept.has(own.id)) return;
    children.splice(Math.min(index, children.length), 0, own);
  });
  return {
    kind: "group",
    id: next !== null && next.conjunction === "and" ? next.id : prev!.id,
    conjunction: "and",
    children,
  };
}

/**
 * `group` without locked rules: every rule marked `locked` or naming one of
 * `prev`'s locked ids is dropped, but the ones `keep` names (a locked rule
 * kept as it is, at the root).
 */
function stripLocked(
  group: FilterGroup,
  ids: ReadonlySet<string>,
  keep: ReadonlySet<string>,
): FilterGroup {
  const children: FilterNode[] = [];
  for (const child of group.children) {
    if (child.kind === "rule") {
      if (keep.has(child.id)) children.push(child);
      else if (child.locked !== true && !ids.has(child.id))
        children.push(child);
    } else {
      children.push(stripLocked(child, ids, new Set()));
    }
  }
  return { ...group, children };
}

/** `filter` without its locked rules — what the user narrows the view by. */
export function unlockedFilter(filter: FilterGroup | null): FilterGroup | null {
  if (filter === null) return null;
  const locked = lockedRules(filter);
  if (locked.length === 0) return filter;
  const ids = new Set(locked.map((r) => r.id));
  return {
    ...filter,
    children: filter.children.filter((n) => !ids.has(n.id)),
  };
}
