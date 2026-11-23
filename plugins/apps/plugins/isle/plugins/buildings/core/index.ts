export { GROUND_BAND, SETTINGS, SHADOW_ALPHA_MAX, SOLID_ALPHA } from "./spec";
export type {
  BuildingSpec,
  Box,
  Chimney,
  Ctx2D,
  Door,
  Footprint,
  Light,
  PaintState,
  Setting,
} from "./spec";
export { shade } from "./shade";

// The painting kit: the drawing helpers generated buildings are made of, for
// bespoke buildings to reuse.
export type { Rnd, Rgb } from "./internal/colour";
export { accent, css, dark, jit, light, mix, rgb } from "./internal/colour";
export type {
  Pt,
  PlanksOptions,
  ShinglesOptions,
  StonesOptions,
  WashOptions,
} from "./internal/draw";
export {
  bbox,
  castShadow,
  grain,
  hline,
  ink,
  ivy,
  moss,
  planks,
  poly,
  rectPts,
  shingles,
  shrub,
  sketch,
  stones,
  thatch,
  tufts,
  wash,
} from "./internal/draw";
export type { DoorArchOptions, WindowOptions } from "./internal/parts";
export {
  barrel,
  bench,
  books,
  chimneySmoke,
  crate,
  doorArch,
  lantern,
  openDoor,
  sack,
  spill,
  steps,
  windowRect,
} from "./internal/parts";
export {
  cart,
  draftingTable,
  easel,
  flowerBox,
  gear,
  ladder,
  lute,
  mailbox,
  swingFrame,
  toolRack,
  waterButt,
} from "./internal/props";

// The polygon kit: the second hand (faces as polygons, palette colour), namespaced.
export { polyKit } from "./internal/poly-kit";

// The fittings kit: metalwork, a round drum, weather, and the small moving parts
// (a cloth, a lamp-lit pane, a line being written) of the folly buildings, namespaced.
export { fittings } from "./internal/fittings";

// The projection: the one receding vector of the island's 3/4 view, the faces of
// volumes (box, extruded edge, roofs) and the face spaces a side or a top is painted in, namespaced.
export type {
  BoxFaces,
  BoxGeom,
  Face,
  P3,
  Rim,
  RoofGeom,
  SolidPaint,
} from "./internal/oblique";
export { oblique } from "./internal/oblique";
// The generator.
export { categoryOfSeed, kitBuilding } from "./internal/kit-building";
