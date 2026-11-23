// Buildings as the renderer holds them: each painted once (per time of day)
// into its own canvas at 2×, an LRU keeping the pixel count bounded; its hit
// mask (what the pointer hits is its drawn shape, not its box); and its hover
// art — a warm rim light round the silhouette and a wash of light on it.

import type {
  Box,
  BuildingSpec,
  PaintState,
} from "@plugins/apps/plugins/isle/plugins/buildings/core";
import type { Pt } from "@plugins/apps/plugins/isle/plugins/world/core";
import { canvas, ctx2d, type Ctx } from "./kit";
import type { Cutter } from "./solid-mask";
import { MASK_A, MASK_C, MASK_DIL, maskFromAlpha, type Mask } from "./hit-mask";

const MASK_A_ANIM = 140;
export const HALO_P = 16;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** One building on the map. */
export interface SceneBuilding {
  /** Stable while the app stands on the same plot facing the same way. */
  readonly key: string;
  readonly appId: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  /** What it may paint, door-relative (its declared footprint). */
  readonly bounds: Box;
  readonly spec: BuildingSpec;
  readonly w: number;
  readonly depth: number;
  readonly signX: number;
  readonly signHalf: number;
  readonly door: Pt;
  /** The live paint state handed to `animate` (t and open move). */
  readonly state: Mutable<PaintState>;
  /** A fresh paint state for a static paint (its stream restarted). */
  readonly fresh: () => PaintState;
}

/** A building's bounds: its declared footprint (ground and upper), a little slack round it. */
export function boundsOf(spec: BuildingSpec): Box {
  const { ground: g, upper: u } = spec.footprint;
  return [
    Math.floor(Math.min(g[0], u ? u[0] : g[0]) - 4),
    Math.floor(Math.min(g[1], u ? u[1] : g[1]) - 4),
    Math.ceil(Math.max(g[2], u ? u[2] : g[2]) + 4),
    Math.ceil(g[3] + 4),
  ];
}

/** A 2D context whose glow draws (`lighter`: forge flicker, beams, light spill) are no-ops — glows never hit. */
function glowless(
  c: HTMLCanvasElement,
  opts?: CanvasRenderingContext2DSettings,
): Ctx {
  const cg = ctx2d(c, opts);
  const P = CanvasRenderingContext2D.prototype;
  const wrap = <
    K extends
      | "fill"
      | "stroke"
      | "fillRect"
      | "strokeRect"
      | "fillText"
      | "strokeText"
      | "drawImage",
  >(
    k: K,
  ) => {
    const f = P[k] as (...a: unknown[]) => void;
    Object.defineProperty(cg, k, {
      value: function (this: Ctx, ...a: unknown[]) {
        if (this.globalCompositeOperation !== "lighter") f.apply(this, a);
      },
    });
  };
  for (const k of [
    "fill",
    "stroke",
    "fillRect",
    "strokeRect",
    "fillText",
    "strokeText",
    "drawImage",
  ] as const)
    wrap(k);
  return cg;
}

interface Baked {
  readonly c: HTMLCanvasElement;
  readonly px: number;
  used: number;
}

interface HoverArt {
  readonly halo: HTMLCanvasElement;
  readonly lit: HTMLCanvasElement;
  readonly sil: HTMLCanvasElement;
  readonly W: number;
  readonly H: number;
}

/** How many hover arts are kept (each up to a building's size at 2×, thrice). */
const HOVER_KEEP = 8;

/**
 * A canvas filter that keeps what of a painting is at least as opaque as the
 * hit mask's threshold — a steep alpha ramp round it, so the edge stays
 * antialiased. An SVG filter the 2D context references by id; made once.
 */
let silFilter: string | null = null;
function silhouetteFilter(): string {
  if (silFilter) return silFilter;
  const NS = "http://www.w3.org/2000/svg";
  const SLOPE = 14;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  const filter = document.createElementNS(NS, "filter");
  filter.id = "isle-building-silhouette";
  filter.setAttribute("x", "0");
  filter.setAttribute("y", "0");
  filter.setAttribute("width", "100%");
  filter.setAttribute("height", "100%");
  filter.setAttribute("color-interpolation-filters", "sRGB");
  const transfer = document.createElementNS(NS, "feComponentTransfer");
  const alpha = document.createElementNS(NS, "feFuncA");
  alpha.setAttribute("type", "linear");
  alpha.setAttribute("slope", String(SLOPE));
  alpha.setAttribute("intercept", (0.5 - (SLOPE * MASK_A) / 255).toFixed(3));
  transfer.appendChild(alpha);
  filter.appendChild(transfer);
  svg.appendChild(filter);
  document.body.appendChild(svg);
  silFilter = `url(#${filter.id})`;
  return silFilter;
}

const BAKE_BUDGET = 70e6;
const BAKE_KEEP = 50e6;

/** Reads a painted building's hit mask elsewhere (a bake worker); `null` when it could not. */
export type MaskReader = (
  c: HTMLCanvasElement,
  bounds: Box,
) => Promise<Mask | null>;

/** Every building's paint, mask and hover art, for one time of day. */
export class BuildingArt {
  private readonly baked = new Map<string, Baked>();
  private bakedPx = 0;
  private readonly masks = new Map<string, Mask>();
  private readonly hover = new Map<string, HoverArt>();
  private readonly probeR = MASK_DIL * MASK_C;
  private readonly probeC = canvas(this.probeR * 2 + 1, this.probeR * 2 + 1);
  private readonly probe = glowless(this.probeC, { willReadFrequently: true });
  private readonly animHaloC = canvas(1, 1);
  private readonly animHaloG = ctx2d(this.animHaloC);
  private readonly animPartC = canvas(1, 1);
  private readonly animPartG = glowless(this.animPartC);
  frame = 0;

  /**
   * `readMask`: where a painted building's hit mask is read ahead, off the
   * page (else it is read here, when first hit-tested); `onError`: a reader's
   * failure (a bug), for the engine to throw.
   */
  constructor(
    private readonly readMask: MaskReader | null = null,
    private readonly onError: (err: Error) => void = (err) => {
      throw err;
    },
  ) {}

  /** Painted buildings whose mask a worker is to read, in idle time. */
  private maskQueue: { key: string; c: HTMLCanvasElement; bounds: Box }[] = [];
  private draining = 0;
  private stopped = false;

  /**
   * Hands the next painted building to the mask reader when the page is idle:
   * handing it over copies the paint (a readback), which would otherwise land
   * in the frames that are busy baking. One a time; a building hit-tested
   * before its turn reads its mask itself.
   */
  private drainMasks(): void {
    if (this.draining || this.stopped || !this.maskQueue.length) return;
    const next = () => {
      this.draining = 0;
      const job = this.maskQueue.shift();
      if (!job || this.stopped) return;
      if (!this.masks.has(job.key) && this.readMask)
        void this.readMask(job.c, job.bounds).then(
          (m) => {
            if (m && !this.masks.has(job.key)) this.masks.set(job.key, m);
          },
          (err: unknown) =>
            this.onError(err instanceof Error ? err : new Error(String(err))),
        );
      this.drainMasks();
    };
    this.draining =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(next, { timeout: 4000 })
        : window.setTimeout(next, 100);
  }

  /** Stops handing masks over (this art is replaced or its engine gone). */
  stop(): void {
    this.stopped = true;
    this.maskQueue = [];
  }

  /** Every hit mask read so far, by building key. */
  maskEntries(): Iterable<[string, Mask]> {
    return this.masks.entries();
  }

  /** Whether the building's paint is baked (drawing it costs no paint). */
  isBaked(b: SceneBuilding): boolean {
    return this.baked.has(b.key);
  }

  /** The building's paint (baked on first use). */
  bake(b: SceneBuilding): HTMLCanvasElement {
    let e = this.baked.get(b.key);
    if (!e) {
      const [x0, y0, x1, y1] = b.bounds;
      const k = 2;
      const c = canvas((x1 - x0) * k, (y1 - y0) * k);
      const cg = ctx2d(c);
      cg.scale(k, k);
      cg.translate(-x0, -y0);
      b.spec.paint(cg, b.fresh());
      e = { c, px: c.width * c.height, used: this.frame };
      if (this.readMask && !this.masks.has(b.key)) {
        this.maskQueue.push({ key: b.key, c, bounds: b.bounds });
        this.drainMasks();
      }
      this.baked.set(b.key, e);
      this.bakedPx += e.px;
      if (this.bakedPx > BAKE_BUDGET) {
        const ents = [...this.baked.entries()].sort(
          (a, z) => a[1].used - z[1].used,
        );
        for (const [k2, v] of ents) {
          if (this.bakedPx < BAKE_KEEP) break;
          if (k2 === b.key) continue;
          this.baked.delete(k2);
          this.bakedPx -= v.px;
        }
      }
    }
    e.used = this.frame;
    return e.c;
  }

  draw(g: Ctx, b: SceneBuilding, x = b.x, y = b.y, cut?: Cutter): void {
    const c = this.bake(b);
    const [x0, y0, x1, y1] = b.bounds;
    g.drawImage(cut ? cut(c) : c, x + x0, y + y0, x1 - x0, y1 - y0);
  }

  private maskOf(b: SceneBuilding): Mask {
    let m = this.masks.get(b.key);
    if (m) return m;
    const c = this.bake(b);
    m = maskFromAlpha(
      ctx2d(c).getImageData(0, 0, c.width, c.height).data,
      c.width,
      c.height,
      b.bounds,
    );
    this.masks.set(b.key, m);
    return m;
  }

  /** Does a moving part cover (lx, ly) — building-local — right now? */
  private animHit(
    b: SceneBuilding,
    lx: number,
    ly: number,
    t: number,
  ): boolean {
    const animate = b.spec.animate;
    if (!animate) return false;
    const pr = this.probeR;
    const p = this.probe;
    b.state.t = t;
    p.setTransform(1, 0, 0, 1, 0, 0);
    p.clearRect(0, 0, this.probeC.width, this.probeC.height);
    p.setTransform(1, 0, 0, 1, pr + 0.5 - lx, pr + 0.5 - ly);
    p.save();
    animate(p, b.state);
    p.restore();
    const n = this.probeC.width;
    const d = p.getImageData(0, 0, n, n).data;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const dx = x - pr;
        const dy = y - pr;
        if (
          dx * dx + dy * dy <= pr * pr &&
          d[(y * n + x) * 4 + 3]! >= MASK_A_ANIM
        )
          return true;
      }
    return false;
  }

  /** Its drawn shape covers world point p. */
  shapeHit(b: SceneBuilding, px: number, py: number, t: number): boolean {
    const [x0, y0, x1, y1] = b.bounds;
    const lx = px - b.x;
    const ly = py - b.y;
    if (lx < x0 || lx >= x1 || ly < y0 || ly >= y1) return false;
    const m = this.maskOf(b);
    if (m.bits[(((ly - y0) / MASK_C) | 0) * m.gw + (((lx - x0) / MASK_C) | 0)])
      return true;
    return this.animHit(b, lx, ly, t);
  }

  /**
   * The hover art, at `K` art px per world px. Its silhouette is cut from the
   * building's own 2× paint, so its edge is the paint's antialiased edge —
   * smooth at every zoom (the hit mask's 2 px cells scaled up were stairs
   * along every diagonal): an alpha threshold at the hit mask's level drops
   * the cast shadow, and the hit mask — only as a loose stencil, its edge a
   * few px outside the building's — drops loose props, as it does for the
   * pointer. All on the canvas: nothing is read back.
   */
  private hoverArtOf(b: SceneBuilding, K: 1 | 2): HoverArt {
    const hk = `${b.key}@${K}`;
    const hit = this.hover.get(hk);
    if (hit) return hit;
    const m = this.maskOf(b);
    const c = this.bake(b);
    const [x0, y0, x1, y1] = b.bounds;
    const W = Math.ceil(x1 - x0);
    const H = Math.ceil(y1 - y0);
    const P = HALO_P;
    const small = canvas(m.gw, m.gh);
    const sg = ctx2d(small);
    const id = sg.createImageData(m.gw, m.gh);
    for (let i = 0; i < m.bits.length; i++)
      if (m.bits[i]) id.data[i * 4 + 3] = 255;
    sg.putImageData(id, 0, 0);
    const sil = canvas(W * K, H * K);
    const lg = ctx2d(sil);
    lg.filter = silhouetteFilter();
    lg.drawImage(c, 0, 0, W * K, H * K);
    lg.filter = "none";
    lg.globalCompositeOperation = "destination-in";
    lg.imageSmoothingEnabled = true;
    lg.drawImage(small, 0, 0, m.gw * MASK_C * K, m.gh * MASK_C * K);
    lg.globalCompositeOperation = "source-over";
    const tint = (
      src: HTMLCanvasElement,
      col: string,
      w = src.width,
      h = src.height,
    ) => {
      const t = canvas(w, h);
      const tg = ctx2d(t);
      tg.drawImage(src, 0, 0, w, h);
      tg.globalCompositeOperation = "source-in";
      tg.fillStyle = col;
      tg.fillRect(0, 0, w, h);
      return t;
    };
    // the soft glow is low-frequency: blurred at 1× and scaled up; the rim is drawn at the art's scale
    const glowS = tint(sil, "#ffcf73", W, H);
    const rimS = tint(sil, "#fff4d2");
    const glow = canvas(W + P * 2, H + P * 2);
    const gg = ctx2d(glow);
    gg.filter = "blur(5px)";
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      gg.drawImage(glowS, P + Math.cos(a) * 4, P + Math.sin(a) * 4);
    }
    const halo = canvas((W + P * 2) * K, (H + P * 2) * K);
    const hg = ctx2d(halo);
    hg.drawImage(glow, 0, 0, halo.width, halo.height);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      hg.drawImage(
        rimS,
        (P + Math.cos(a) * 2.2) * K,
        (P + Math.sin(a) * 2.2) * K,
      );
    }
    hg.globalCompositeOperation = "destination-out";
    hg.drawImage(sil, P * K, P * K);
    // the light on the building: its silhouette as a flat warm wash
    const lit = tint(sil, "#fff6dc");
    const art = { halo, lit, sil, W, H };
    this.hover.set(hk, art);
    // (a few buildings' art at most: the oldest goes first, never the one just made)
    for (const k of this.hover.keys()) {
      if (this.hover.size <= HOVER_KEEP) break;
      if (k !== hk) this.hover.delete(k);
    }
    return art;
  }

  /**
   * The hovered building's moving parts (`animate`, never `ambient`) as they
   * stand now (`b.state.t`): their shape, and the rim of light round it — cut out inside
   * the parts and inside the static silhouette, so only the outline of the
   * whole (building and parts) is lit. Drawn at `k` canvas px per world px.
   */
  private animParts(b: SceneBuilding, h: HoverArt, k: number) {
    const animate = b.spec.animate!;
    const {
      c: pc,
      x,
      y,
      w,
      h: hh,
      M,
    } = this.stencil(h, b, k, (g) => animate(g, b.state));
    const pg = this.animPartG;
    const W = pc.width;
    const H = pc.height;
    const tint = (col: string) => {
      pg.globalCompositeOperation = "source-in";
      pg.fillStyle = col;
      pg.fillRect(0, 0, W, H);
      pg.globalCompositeOperation = "source-over";
    };
    const ring = (n: number, r: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        hg.drawImage(pc, Math.cos(a) * r * k, Math.sin(a) * r * k);
      }
    };
    const hg = this.animHaloG;
    hg.setTransform(1, 0, 0, 1, 0, 0);
    hg.globalCompositeOperation = "source-over";
    hg.globalAlpha = 1;
    hg.clearRect(0, 0, W, H);
    // the same light as the static halo's: a blurred glow, then the crisp rim
    tint("#ffcf73");
    hg.filter = `blur(${5 * k}px)`;
    ring(8, 4);
    hg.filter = "none";
    tint("#fff4d2");
    ring(16, 2.2);
    hg.globalAlpha = 1;
    hg.globalCompositeOperation = "destination-out";
    hg.drawImage(pc, 0, 0);
    hg.drawImage(h.sil, M, M, h.W * k, h.H * k);
    hg.globalCompositeOperation = "source-over";
    // the parts themselves, as the wash of light on them (where the static silhouette is not already washed)
    tint("#fff6dc");
    return { ring: this.animHaloC, parts: pc, x, y, w, h: hh, m: M / k };
  }

  /**
   * What `draw` paints of the building (glows left out), on the scratch
   * canvas at `k` canvas px per world px with a halo's margin round its
   * bounds: where it lies, building-local. The scratch is reused — good until
   * the next call.
   */
  private stencil(
    h: HoverArt,
    b: SceneBuilding,
    k: number,
    draw: (g: Ctx) => void,
  ) {
    const [x0, y0] = b.bounds;
    const M = Math.ceil(HALO_P * k);
    const W = Math.ceil(h.W * k) + M * 2;
    const H = Math.ceil(h.H * k) + M * 2;
    const pc = this.animPartC;
    const pg = this.animPartG;
    if (pc.width !== W || pc.height !== H) {
      pc.width = this.animHaloC.width = W;
      pc.height = this.animHaloC.height = H;
    }
    pg.setTransform(1, 0, 0, 1, 0, 0);
    pg.globalCompositeOperation = "source-over";
    pg.clearRect(0, 0, W, H);
    pg.setTransform(k, 0, 0, k, M - x0 * k, M - y0 * k);
    pg.save();
    draw(pg);
    pg.restore();
    pg.setTransform(1, 0, 0, 1, 0, 0);
    return { c: pc, x: x0 - M / k, y: y0 - M / k, w: W / k, h: H / k, M };
  }

  /**
   * The hover art at alpha a (glowOnly: the faint wash, at dusk and night),
   * for the building as it stands at `t`. ONE rule for what is lit: the
   * building's shape — its static paint and its moving parts (`animate`)
   * where they are right now; never what lives around it (`ambient`). The rim
   * runs round the outline of the two together (no rim where a moving part
   * covers the static edge, none round the part where it lies on the
   * building), and the wash covers both evenly. So the engine draws it OVER
   * `animate` and UNDER `ambient`.
   *
   * `g` must be a layer of its own, already clear: the static rim is cut out
   * of it where a moving part stands. `scale`: device px per world px it is
   * drawn at — the art is made at 1× up to one, at 2× beyond (zoomed in, or a
   * dense screen).
   */
  drawHover(
    g: Ctx,
    b: SceneBuilding,
    a: number,
    glowOnly: boolean,
    t: number,
    scale: number,
  ): void {
    const K = scale > 1.02 ? 2 : 1;
    const h = this.hoverArtOf(b, K);
    const [x0, y0] = b.bounds;
    const wash = a * (glowOnly ? 0.06 : 0.13);
    b.state.t = t;
    g.globalAlpha = a;
    g.drawImage(
      h.halo,
      b.x + x0 - HALO_P,
      b.y + y0 - HALO_P,
      h.W + HALO_P * 2,
      h.H + HALO_P * 2,
    );
    const q = b.spec.animate ? this.animParts(b, h, K / 2) : null;
    if (q) {
      g.globalAlpha = 1;
      g.globalCompositeOperation = "destination-out";
      g.drawImage(q.parts, b.x + q.x, b.y + q.y, q.w, q.h);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = a;
      g.drawImage(q.ring, b.x + q.x, b.y + q.y, q.w, q.h);
    }
    g.globalAlpha = wash;
    g.drawImage(h.lit, b.x + x0, b.y + y0, h.W, h.H);
    if (q) {
      // the parts' wash, where the building's own does not already lie
      const pg = this.animPartG;
      pg.globalCompositeOperation = "destination-out";
      pg.drawImage(
        h.sil,
        q.m * (K / 2),
        q.m * (K / 2),
        (h.W * K) / 2,
        (h.H * K) / 2,
      );
      pg.globalCompositeOperation = "source-over";
      g.drawImage(q.parts, b.x + q.x, b.y + q.y, q.w, q.h);
    }
    g.globalAlpha = 1;
    // what lives around the building stands in front of its light (the engine lays this layer over the scene's
    // lights a second time): cut out of it, as the people in front are
    const ambient = b.spec.ambient;
    if (ambient) {
      const c = this.stencil(h, b, K / 2, (pg) => ambient(pg, b.state));
      g.globalCompositeOperation = "destination-out";
      g.drawImage(c.c, b.x + c.x, b.y + c.y, c.w, c.h);
      g.globalCompositeOperation = "source-over";
    }
  }

  /** The hover art's size, world px (for its layer). */
  hoverSize(b: SceneBuilding): { W: number; H: number } {
    const [x0, y0, x1, y1] = b.bounds;
    return { W: Math.ceil(x1 - x0), H: Math.ceil(y1 - y0) };
  }
}
