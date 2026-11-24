// The open sea, painted into a map tile on the page: nothing here repeats.
// The colour is a slow field of the WORLD position — a paler shelf round each
// island, deeper basins offshore, currents, the shade of a cloud — sampled on
// a coarse grid once for the whole world (`SeaField`) that every tile is cut
// from (so they join without a seam) and that stands in for a tile not built
// yet (so a tile appearing never changes the sea's colour), washed in smoothly; the seamless grain (`oceanKernel`) lies over it as fine
// paper tooth only; and the wave marks are strokes placed by world-space noise
// — ruffled water here, calm there, their lengths and headings varying — fewer
// and fainter the further out the tile's zoom, so they never read as a
// pattern. Canvas work, on the page only (like the rest of a map tile); the
// workers bake none of it.

import {
  fbm,
  vnoise,
  type Island,
} from "@plugins/apps/plugins/isle/plugins/world/core";
import { canvas, ctx2d, seeded, ss, type Ctx } from "./kit";
import {
  ABYSS_C,
  DEEP_C,
  GT,
  mixTo,
  OCEAN_FLAT,
  type HeightFn,
  type Rgb,
} from "./ground-pixels";

/** World px between the colour field's samples. */
const Q = 16;

const TRENCH: Rgb = [29, 80, 126];
const CURRENT: Rgb = [62, 132, 172];
/** The water at an island's bounds, where its baked ground fades out (`groundPixel` at that depth). */
const SHELF: Rgb = mixTo([0, 0, 0], DEEP_C, ABYSS_C, 0.45);
const SHADE: Rgb = [30, 74, 112];

/** How near an island's shelf a point is, 0 (far out) … 1 (at its bounds). */
function shelfOf(islands: readonly Island[], X: number, Y: number): number {
  let s = 0;
  for (const I of islands) {
    const [x0, y0, x1, y1] = I.bounds;
    const dx = X < x0 ? x0 - X : X > x1 ? X - x1 : 0;
    const dy = Y < y0 ? y0 - Y : Y > y1 ? Y - y1 : 0;
    if (dx > 1400 || dy > 1400) continue;
    const d = Math.hypot(dx, dy);
    const v = Math.exp(-d / 360);
    if (v > s) s = v;
  }
  return s;
}

/** The open sea's colour at a world point. */
function seaColour(
  col: Rgb,
  islands: readonly Island[],
  X: number,
  Y: number,
): void {
  // the grain of the sea runs a little off the page's axes
  const u = X * 0.94 + Y * 0.34;
  const v = Y * 0.94 - X * 0.34;
  const basin = fbm(X / 2300 + 17.1, Y / 2300 + 3.3, 3);
  const band = fbm(u / 1500 + 5.7, v / 430 + 21.9, 3);
  const cloud = fbm(X / 1900 + 71.3, Y / 1500 + 40.1, 2);
  const ruffle = fbm(u / 340 + 9.9, v / 150 + 2.2, 2);
  mixTo(col, DEEP_C, ABYSS_C, ss(0.3, 0.62, basin));
  mixTo(col, col, TRENCH, ss(0.55, 0.8, basin) * 0.75);
  mixTo(col, col, CURRENT, ss(0.52, 0.74, band) * 0.4);
  mixTo(col, col, SHADE, ss(0.56, 0.72, cloud) * 0.42);
  // (the ruffle fades with it: at the bounds the sea is exactly the ground's own deep water)
  const shelf = Math.min(1, shelfOf(islands, X, Y) * 1.5);
  if (shelf > 0) mixTo(col, col, SHELF, shelf);
  const k = (ruffle - 0.5) * 9 * (1 - shelf);
  col[0] += k;
  col[1] += k;
  col[2] += k;
}

/**
 * The open sea's colour over the whole world, one sample every Q world px on
 * the grid every tile shares — what each tile's sea is cut from, and what
 * stands in for a tile not built yet, so a tile appearing changes nothing but
 * its wave marks. It spans `box` (world px: what the camera can show), on
 * the tile grid. Built a row at a time within the bake budget (`step`); a
 * world whose islands change, or a view reaching past it, gets a new one, the
 * old drawn until it is done.
 */
export class SeaField {
  /** World position of sample (0, 0). */
  readonly x0: number;
  readonly y0: number;
  private readonly nx: number;
  private readonly ny: number;
  readonly c: HTMLCanvasElement;
  private readonly g: Ctx;
  private readonly img: ImageData;
  private row = 0;

  constructor(
    /** The islands it was built for (their shelves). */
    readonly islandKey: string,
    box: readonly number[],
    private readonly islands: readonly Island[],
  ) {
    this.x0 = Math.floor(box[0]! / GT) * GT;
    this.y0 = Math.floor(box[1]! / GT) * GT;
    this.nx = (Math.ceil(box[2]! / GT) * GT - this.x0) / Q + 1;
    this.ny = (Math.ceil(box[3]! / GT) * GT - this.y0) / Q + 1;
    this.c = canvas(this.nx, this.ny);
    this.g = ctx2d(this.c);
    this.img = this.g.createImageData(this.nx, this.ny);
  }

  /** Whether it spans the world box (x0, y0, x1, y1). */
  covers(box: readonly number[]): boolean {
    return (
      box[0]! >= this.x0 &&
      box[1]! >= this.y0 &&
      box[2]! <= this.x0 + (this.nx - 1) * Q &&
      box[3]! <= this.y0 + (this.ny - 1) * Q
    );
  }

  get done(): boolean {
    return this.row >= this.ny;
  }

  /** Samples rows while `left()`; → true once every row is in (and on the canvas). */
  step(left: () => boolean): boolean {
    if (this.done) return true;
    const d = this.img.data;
    const col: Rgb = [0, 0, 0];
    while (this.row < this.ny && left()) {
      const j = this.row++;
      for (let i = 0; i < this.nx; i++) {
        seaColour(col, this.islands, this.x0 + i * Q, this.y0 + j * Q);
        const k = (j * this.nx + i) * 4;
        d[k] = col[0];
        d[k + 1] = col[1];
        d[k + 2] = col[2];
        d[k + 3] = 255;
      }
    }
    if (!this.done) return false;
    this.g.putImageData(this.img, 0, 0);
    return true;
  }

  /**
   * Paints the world rect (X0, Y0, w, h) of it, washed in smoothly: each
   * sample's centre on its grid point, so every rect it is cut into joins.
   */
  draw(g: Ctx, X0: number, Y0: number, w: number, h: number): void {
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(
      this.c,
      (X0 - this.x0) / Q + 0.5,
      (Y0 - this.y0) / Q + 0.5,
      w / Q,
      h / Q,
      X0,
      Y0,
      w,
      h,
    );
  }
}

/** How many wave marks a 512 px cell may hold at full zoom. */
const MARKS = 150;

/**
 * Paints tile (X0, Y0)'s open sea, under its baked ground: its colour cut from
 * `sea`, `lod` is the tile's zoom (px per world px), `grain` the seamless tooth
 * (null until baked), `H` the islands' height (null where no island is near:
 * open water all over).
 */
export function paintSea(
  g: Ctx,
  sea: SeaField,
  grain: CanvasPattern | null,
  X0: number,
  Y0: number,
  lod: number,
  H: HeightFn | null,
): void {
  g.save();
  g.beginPath();
  g.rect(X0, Y0, GT, GT);
  g.clip();
  // (past the field — a zoom overshooting further than it reaches — the sea's flat colour)
  g.fillStyle = OCEAN_FLAT;
  g.fillRect(X0, Y0, GT, GT);
  sea.draw(g, X0, Y0, GT, GT);
  if (grain) {
    g.fillStyle = grain;
    g.fillRect(X0, Y0, GT, GT);
  }
  // wave marks: each 512 px cell places its own, neighbours' reach in
  const keep = lod >= 1 ? 1 : lod >= 0.5 ? 0.5 : 0.2;
  const fade = lod >= 1 ? 1 : lod >= 0.5 ? 0.8 : 0.6;
  const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  const tx = Math.round(X0 / GT);
  const ty = Math.round(Y0 / GT);
  for (let dj = -1; dj <= 1; dj++)
    for (let di = -1; di <= 1; di++) {
      const bx = (tx + di) * GT;
      const by = (ty + dj) * GT;
      const r = seeded(
        ((((tx + di) * 73856093) ^ ((ty + dj) * 19349663)) >>> 0) + 4177,
      );
      for (let k = 0; k < MARKS; k++) {
        const x = bx + r() * GT;
        const y = by + r() * GT;
        const rank = r();
        const l0 = r();
        const turn = r();
        const kind = r();
        const bow = r();
        if (rank > keep) continue;
        if (x < X0 - 60 || x > X0 + GT + 60 || y < Y0 - 30 || y > Y0 + GT + 30)
          continue;
        // ruffled water here, calm there
        const rough =
          fbm(x / 760 + 33.3, y / 520 + 8.1, 2) * 0.75 +
          vnoise(x / 170 + 1.7, y / 120 + 6.3) * 0.25;
        if (rank > keep * ss(0.34, 0.7, rough)) continue;
        if (H && H(x, y) > -0.36) continue; // the shallows carry their own streaks
        const len = (14 + l0 * l0 * 50) * (0.6 + rough * 0.9);
        const a =
          (vnoise(x / 1300 + 90.1, y / 1300 + 14.4) - 0.5) * 1.1 +
          (turn - 0.5) * 0.36;
        const ux = Math.cos(a) * len;
        const uy = Math.sin(a) * len;
        const P = paths[(kind < 0.55 ? 0 : 2) + (l0 > 0.5 ? 1 : 0)]!;
        P.moveTo(x - ux, y - uy);
        P.quadraticCurveTo(
          x - uy * (bow - 0.5) * 0.3,
          y + ux * (bow - 0.5) * 0.3,
          x + ux,
          y + uy,
        );
      }
    }
  g.lineCap = "round";
  const style = [
    ["235,246,248", 0.07, 3.4],
    ["235,246,248", 0.05, 6.5],
    ["20,56,96", 0.07, 3.8],
    ["20,56,96", 0.05, 7.5],
  ] as const;
  style.forEach(([rgb, al, lw], i) => {
    g.strokeStyle = `rgba(${rgb},${al * fade})`;
    g.lineWidth = lw;
    g.stroke(paths[i]!);
  });
  g.restore();
}
