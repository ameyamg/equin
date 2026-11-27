/** Small numeric helpers shared by the world, the scene and the scroll skeleton. */
export const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

export const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

/** Rounded to one decimal: brick corners stay on a tenth of a stud. */
export const r1 = (v: number): number => Math.round(v * 10) / 10;

export type Vec3 = readonly [number, number, number];

/** The one element of `root` matching `sel`. Throws when it is missing. */
export function one<E extends Element>(root: ParentNode, sel: string): E {
  const el = root.querySelector<E>(sel);
  if (!el) throw new Error(`[plugin-system] no ${sel} in the page`);
  return el;
}

/** Every element of `root` matching `sel`. Throws when there is none. */
export function all<E extends Element>(root: ParentNode, sel: string): E[] {
  const list = [...root.querySelectorAll<E>(sel)];
  if (!list.length) throw new Error(`[plugin-system] no ${sel} in the page`);
  return list;
}
