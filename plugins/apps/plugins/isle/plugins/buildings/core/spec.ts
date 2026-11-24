// The building contract: what an app's building declares (its footprint, the
// spot it likes, its night lights) and how it is drawn (`paint`, `animate`).
// Pure data and canvas functions — no DOM, no React — so a worker can paint one.

/** A 2D context a building or a character paints into: on-screen or offscreen. */
export type Ctx2D =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** An axis-aligned box `[x0, y0, x1, y1]` (x0 ≤ x1, y0 ≤ y1). */
export type Box = readonly [number, number, number, number];

/**
 * Where a building likes to stand — the terrain around a plot. `coast` (the sea
 * within reach), `cape` (sea on many sides), `shore` (by a river or a lake),
 * `harbour` (by the dock or a pier), `hill`, `forest` (at a wood's edge),
 * `square` (on a district square), `lane` (along a street or a road).
 */
export type Setting = (typeof SETTINGS)[number];

/** Every {@link Setting}. */
export const SETTINGS = [
  "coast",
  "cape",
  "shore",
  "harbour",
  "hill",
  "forest",
  "square",
  "lane",
] as const;

/**
 * Coordinates are relative to the door: (0, 0) is the ground at the middle of
 * the front door's threshold, y grows DOWN (up is negative). The player is ~50
 * px tall; a building is ~150–240 px wide and up to ~300 px tall.
 *
 * A plot splits what a building covers at y = -{@link GROUND_BAND}: the GROUND
 * band below it (base, props, shadow) — bands of two plots never touch — and
 * the UPPER part above it (walls, roof, tower), which may rise in front of the
 * ground of the plot behind.
 */
export const GROUND_BAND = 112;

/**
 * What a building covers — DECLARED, never measured at runtime, so placement is
 * a pure function. The footprint test paints every building and checks its ink
 * stays inside (`buildings/core/testing`'s `paintedExtent`). Glows — what is
 * drawn with `globalCompositeOperation = "lighter"` (a lighthouse's beams, a
 * forge's flicker) — are light, not ink: they are not part of it.
 */
export interface Footprint {
  /** The solid base the walker cannot cross: x ∈ [-w/2, w/2], y ∈ [-depth, 0]. */
  readonly w: number;
  readonly depth: number;
  /** Everything painted at y ≥ -GROUND_BAND (base, props, shadow), animation included. */
  readonly ground: Box;
  /** Everything painted above y = -GROUND_BAND, or null when nothing rises that high. */
  readonly upper: Box | null;
}

/**
 * How opaque a pixel of a building's paint must be to count as the building
 * (0..1): the pointer hits it and the hover light outlines it. Fainter paint —
 * a cast shadow, a wash on the grass — lies under the building, not in it.
 */
export const SOLID_ALPHA = 143 / 255;

/**
 * The darkest one shadow on the ground may get, so that TWO lying over one
 * another (a prop's in the building's) still stay under {@link SOLID_ALPHA},
 * with room for the antialiased ramp the hover silhouette is cut with. The
 * kit's shadows (`castShadow`, `fittings.ellShadow`) hold themselves to it; a
 * shadow drawn by hand must too.
 */
export const SHADOW_ALPHA_MAX = 1 - Math.sqrt(1 - (SOLID_ALPHA - 0.05));

/** A night glow: `[x, y, radius]`, door-relative. */
export type Light = readonly [number, number, number];

/**
 * A chimney's mouth, door-relative, and the smoke it gives: `puffs` in flight
 * (default 6), `spread` (how far they drift, default 1), `phase` (seconds, so
 * neighbours do not puff in step). Data, not paint: the renderer draws the
 * smoke (`chimneySmoke`), as thick as the app is lived in — a building whose
 * app is never opened stays quiet.
 */
export interface Chimney {
  readonly x: number;
  readonly y: number;
  readonly puffs?: number;
  readonly spread?: number;
  readonly phase?: number;
}

/** What `paint` / `animate` are handed. */
export interface PaintState {
  /** Seconds since the scene started (animate only; 0 for paint). */
  readonly t: number;
  readonly night: boolean;
  readonly dusk: boolean;
  /** The app's accent colour, `#rrggbb` (its tile colour). */
  readonly hue: string;
  /** `col` darkened (k < 0) or lightened (k > 0) by |k|, as `rgb(…)`. */
  shade(col: string, k: number): string;
  /** A random stream seeded from the app id: the same app paints the same picture. */
  rnd(): number;
  /** Draws the app's icon glyph, centred on (cx, cy), `size` px tall, in the current fill style. */
  glyph(g: Ctx2D, cx: number, cy: number, size: number): void;
}

/**
 * The doorway's shape — what the open door lights up, so it is REQUIRED of
 * every door: a building cannot declare a door with no open state. `w` wide,
 * `h` tall from its threshold to the top of its head; `head` is how far the head
 * rises above its jambs (0 a square head, `w / 2` a round arch, between: a
 * segmental or elliptical one); the threshold lies `y` below the origin
 * (default 0; negative: up a step, on a stage).
 */
export interface Doorway {
  readonly w: number;
  readonly h: number;
  readonly head: number;
  readonly y?: number;
}

/**
 * The front door. Data, not paint: the engine opens it while the player stands
 * there (`openDoor`) — so every building's door opens the same way, and none
 * can forget to.
 *
 * - `leaf`: a door the building paints shut; open, it has swung in out of
 *   sight (hinged on the right, it lies behind the front wall in the high 3/4
 *   view): the doorway shows its reveal, its sill and a warm-lit room, its
 *   light spilling out over the ground.
 * - `opening`: always open — a bay, wide doors swung back, a tent's tied-back
 *   flaps, a stage: the building paints what is inside; open, its lamps come
 *   on — a warm glow over the doorway, the light spilling out.
 */
export type Door = { readonly kind: "leaf" | "opening" } & Doorway;

export interface BuildingSpec {
  readonly footprint: Footprint;
  /** Its front door: the engine opens it while the player stands there. */
  readonly door: Door;
  /** The spots it likes, first choice first (the coast, a hill…); none: anywhere. */
  readonly setting?: readonly Setting[];
  /**
   * Where its signpost stands, door-relative x (the engine may mirror it to the
   * other side). Omitted: just past the base, `-(w / 2 + 30)`.
   */
  readonly signX?: number;
  readonly lights: readonly Light[];
  /** Its chimney, if it has one: the renderer draws its smoke. */
  readonly chimney?: Chimney;
  /** The static picture: painted once per time of day and cached by the engine. */
  paint(g: Ctx2D, s: PaintState): void;
  /**
   * The building's own MOVING PARTS (a turning sail, a crane's load, a swing,
   * a flag, a beam — never chimney smoke: that is `chimney`), drawn every
   * frame over the cached paint. They are part of the building's shape: the
   * pointer hits them, and the hover outline and wash follow them as they
   * move. What merely lives around the building goes in `ambient`.
   */
  animate?(g: Ctx2D, s: PaintState): void;
  /**
   * What lives AROUND the building, drawn every frame over everything else of
   * it: creatures that roam (ants, birds, a cat), and what drifts loose of it
   * (sparks, notes, confetti, bubbles, steam, falling leaves). Never part of
   * its shape — the pointer does not hit it, and hovering the building
   * neither outlines nor washes it (a halo round every ant flickers as it
   * walks). Inside the declared footprint, like everything else.
   */
  ambient?(g: Ctx2D, s: PaintState): void;
}
