// Which ink is the projection's own. The kit marks what it draws for the 3/4
// view (`oblique`'s faces and face spaces, a cast shadow) by drawing it inside
// `withinProjection`; the measuring context of `core/testing` reads the mark,
// so the perspective test can tell a face the kit produced from a receding
// polygon a painter spelled by hand.

/** How deep inside a kit-drawn region each context is. */
const depth = new WeakMap<object, number>();

/** Whether `g` is drawing inside the projection right now. */
export const insideProjection = (g: object): boolean => (depth.get(g) ?? 0) > 0;

/** Runs `draw` as the projection's own ink. */
export function withinProjection(g: object, draw: () => void): void {
  depth.set(g, (depth.get(g) ?? 0) + 1);
  try {
    draw();
  } finally {
    depth.set(g, (depth.get(g) ?? 1) - 1);
  }
}
