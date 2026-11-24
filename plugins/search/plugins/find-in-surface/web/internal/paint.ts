/**
 * The names matches are painted under — the ones `find-in-surface.css`
 * styles, scoped to `[data-find-root]`.
 */
const MATCH = "find-match";
const ACTIVE = "find-match-active";

interface Painted {
  matches: readonly Range[];
  active: Range | null;
}

/**
 * Every live find bar's ranges. `CSS.highlights` is ONE registry per document,
 * and two panes side by side can each have their bar open — so each bar owns
 * an entry here and the registered highlights are the union.
 */
const painters = new Map<symbol, Painted>();

function sync(): void {
  // Newer than the browser floor in some engines; without it no match can be
  // shown, so say so rather than show a count with nothing highlighted.
  if (
    typeof CSS === "undefined" ||
    !("highlights" in CSS) ||
    typeof Highlight === "undefined"
  )
    throw new Error(
      "find-in-surface: the CSS Custom Highlight API is unavailable",
    );
  const matches: Range[] = [];
  const active: Range[] = [];
  for (const p of painters.values()) {
    for (const r of p.matches) if (r !== p.active) matches.push(r);
    if (p.active) active.push(p.active);
  }
  if (matches.length === 0) CSS.highlights.delete(MATCH);
  else CSS.highlights.set(MATCH, new Highlight(...matches));
  if (active.length === 0) CSS.highlights.delete(ACTIVE);
  else CSS.highlights.set(ACTIVE, new Highlight(...active));
}

/** Paint one bar's matches (the active one distinct), replacing its last paint. */
export function paintMatches(key: symbol, painted: Painted): void {
  painters.set(key, painted);
  sync();
}

/** Remove one bar's paint. */
export function clearMatches(key: symbol): void {
  if (painters.delete(key)) sync();
}
