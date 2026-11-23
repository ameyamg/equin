/**
 * Marks the editable surface's BLOCK GRID — the single-column grid whose
 * children are the row cells and, beside them, the container frames (callout
 * tint, quote rule, annotation wash) that span their grid lines.
 *
 * A reader that measures frames (an e2e script) finds the grid by this mark,
 * never by counting wrappers up from a row: a row cell gains wrappers as the
 * row learns things (the remote-arrival `<Arrival>` wrapper did), and every
 * `row.parentElement.parentElement` went silently stale with it.
 */
export const BLOCK_GRID_ATTR = "data-block-grid";
