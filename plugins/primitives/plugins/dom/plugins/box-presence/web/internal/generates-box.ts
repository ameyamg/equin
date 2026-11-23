// ── Does this element generate a box? ────────────────────────────────────────
//
// The question an open popover asks of its anchor, a bar of its cells, a guard
// of the children it measures: is this element drawn as anything at all? NOT
// "is it visible" — `visibility: hidden` and a zero-size box still generate a
// box; `display: none` on it or an ancestor, `display: contents` on itself, and
// leaving the document do not.
//
// In a browser the layout engine answers it: `getClientRects()` is empty
// exactly when the element generates no box. A host with no layout engine
// (jsdom) returns an empty list for EVERY element, so reading the rects there
// answers "hidden" everywhere — every popover closed itself under jsdom
// (2026-11-19, 1e701291e9). Such a host declares itself once, at its entry
// (`declareNoLayoutEngine`, web/testing), and the question is answered from
// what it does have: the computed `display` up the ancestor chain. That is the
// same rule the layout engine applies, minus the geometry nobody asked about.
//
// The `box-presence/no-raw-box-presence` lint rule sends every other
// `getClientRects().length` read here, so no primitive can ask the layout
// engine around the seam.

type BoxProbe = (el: Element) => boolean;

/** The layout engine's answer: an element with no box has no client rects. */
const layoutProbe: BoxProbe = (el) => el.getClientRects().length > 0;

/**
 * The answer without a layout engine: in the document, not `display: contents`
 * itself, and no `display: none` on it or any ancestor (the `hidden`
 * attribute included — it is `display: none` in the UA stylesheet).
 */
const displayProbe: BoxProbe = (el) => {
  if (!el.isConnected) return false;
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  if (view.getComputedStyle(el).display === "contents") return false;
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    if (view.getComputedStyle(cur).display === "none") return false;
  }
  return true;
};

let probe: BoxProbe = layoutProbe;
let read = false;

/**
 * Declare this process a host with no layout engine (jsdom). Called ONCE, by
 * the test setup, before any test reads a box. Throws on a second declaration,
 * and after a box was already read through the layout engine (the two answers
 * would disagree inside one run).
 */
export function declareNoLayoutEngine(): void {
  if (probe === displayProbe)
    throw new Error(
      "[box-presence] declareNoLayoutEngine called twice — declare it once, at the host's entry.",
    );
  if (read)
    throw new Error(
      "[box-presence] declareNoLayoutEngine called after a box was already read through the layout engine — declare it at the host's entry, before anything renders.",
    );
  probe = displayProbe;
}

/**
 * Whether `el` generates a box: `false` when it left the document, is
 * `display: contents`, or sits under `display: none` (itself included).
 * `visibility: hidden` and a 0×0 box still generate one.
 */
export function generatesBox(el: Element): boolean {
  read = true;
  return probe(el);
}
