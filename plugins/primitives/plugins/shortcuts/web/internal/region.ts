import type { ShortcutDescriptor, ShortcutRegion } from "./types";

/** Where the key landed and where the pointer is, at the keystroke. */
export interface KeyPlace {
  /** The key event's target: the focused element (or the body). */
  focus: Node | null;
  /** The element last under the pointer; `null` once it left the page. */
  pointer: Node | null;
}

/**
 * The regioned shortcuts among `candidates` (all matching one keystroke and
 * otherwise eligible) that may fire — see {@link ShortcutRegion} for the
 * rule. Unregioned candidates are not this function's: the caller keeps them
 * as they are.
 */
export function regionWinners<T extends Pick<ShortcutDescriptor, "region">>(
  candidates: readonly T[],
  at: KeyPlace,
): T[] {
  const mounted = candidates.flatMap((c) => {
    const root = c.region?.root.current ?? null;
    return root === null ? [] : [{ c, root }];
  });
  const holding = (
    place: Node | null,
    eligible: (r: ShortcutRegion) => boolean,
  ) =>
    place === null
      ? []
      : mounted.filter((m) => eligible(m.c.region!) && m.root.contains(place));
  const byFocus = holding(at.focus, () => true);
  const owners =
    byFocus.length > 0 ? byFocus : holding(at.pointer, (r) => r.pointer);
  if (owners.length > 0) {
    // The innermost: a region holding another holder is its ancestor.
    const innermost = owners.filter(
      (o) =>
        !owners.some(
          (p) => p !== o && p.root !== o.root && o.root.contains(p.root),
        ),
    );
    return innermost.map((o) => o.c);
  }
  // No region holds the key: only a region alone on its key takes it.
  return mounted.length === 1 ? [mounted[0]!.c] : [];
}
