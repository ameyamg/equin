/**
 * The recorder's sizes: the page layout each preset sizes the window to (the
 * standard recording sizes, in CSS px), and the window bounds that give the
 * tab that layout. The video is always every physical pixel of that page
 * (layout × the display's pixel ratio: a 1080p page on a Retina display is a
 * 3840 × 2160 video). Pure — the shell's worker
 * (`browser-extension/background.ts`) resizes with it, the panel marks a
 * preset it refuses (too big for this screen, a zoomed page), with the same
 * reason.
 */

/** A recording size, as the panel's dropdown lists it (a closed list). */
export type RecordPresetId = "720p" | "1080p" | "1440p" | "vertical" | "as-is";

export interface RecordPreset {
  id: RecordPresetId;
  label: string;
  /** The page's CSS layout the window is resized to; `null`: kept as it is. */
  page: { width: number; height: number } | null;
}

export const RECORD_PRESETS: readonly RecordPreset[] = [
  { id: "720p", label: "720p", page: { width: 1280, height: 720 } },
  { id: "1080p", label: "1080p", page: { width: 1920, height: 1080 } },
  { id: "1440p", label: "1440p", page: { width: 2560, height: 1440 } },
  // A phone's layout (a 1080 × 1920 page fits no landscape screen); the
  // video is 1080 × 1920 on a Retina display.
  { id: "vertical", label: "9:16", page: { width: 540, height: 960 } },
  { id: "as-is", label: "As is", page: null },
];

export function recordPreset(id: RecordPresetId): RecordPreset {
  const preset = RECORD_PRESETS.find((p) => p.id === id);
  if (preset === undefined) throw new Error(`no record preset ${id}`);
  return preset;
}

/** A preset as the panel names it: its page size (`1280 × 720`), or As is. */
export function presetSizeText(preset: RecordPreset): string {
  return preset.page === null
    ? preset.label
    : `${preset.page.width} × ${preset.page.height}`;
}

/** The recorded tab and its window, as measured before a recording. */
export interface TabMeasure {
  /** The window's outer bounds, in screen points. */
  window: { left: number; top: number; width: number; height: number };
  /** `normal`, `maximized`, `fullscreen`, `minimized`. */
  windowState: string;
  /** The page's viewport, in CSS px. */
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  /** The tab's zoom factor (1 = 100%). */
  zoom: number;
  /** The display's work area (`screen.avail*`), in points. */
  workArea: { left: number; top: number; width: number; height: number };
}

/** Why a preset cannot record this tab. */
export type SizeRefusal = "does-not-fit" | "zoomed";

export type SizeResult<T> =
  { ok: true; value: T } | { ok: false; reason: SizeRefusal };

export interface WindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The window bounds that give the tab a `page`-sized viewport: the page plus
 * the window's chrome (`outer − inner`: tab strip, toolbar, bookmarks bar,
 * measured, since it varies), kept on its display — moved up/left when it
 * would leave the work area, refused when it is bigger than it. A zoomed tab
 * is refused: its CSS px are not the window's points.
 */
export function windowBoundsFor(
  page: { width: number; height: number },
  m: TabMeasure,
): SizeResult<WindowBounds> {
  if (Math.abs(m.zoom - 1) > 1e-3) return { ok: false, reason: "zoomed" };
  const width = page.width + (m.window.width - m.innerWidth);
  const height = page.height + (m.window.height - m.innerHeight);
  const area = m.workArea;
  if (width > area.width || height > area.height)
    return { ok: false, reason: "does-not-fit" };
  const left = clamp(m.window.left, area.left, area.left + area.width - width);
  const top = clamp(m.window.top, area.top, area.top + area.height - height);
  return { ok: true, value: { left, top, width, height } };
}

/**
 * The largest frame the recorder's encoder takes, in 16 × 16 macroblocks:
 * H.264 level 5.1 (`avc1.640033`, `offscreen.ts`), 4096 × 2304. A page whose
 * physical pixels exceed it (a 2560 × 1440 layout at DPR 2) is recorded at
 * the largest size under it, its aspect kept.
 */
export const MAX_FRAME_MACROBLOCKS = 36_864;

/**
 * The video size `preset` records `m`'s tab at: every physical pixel of the
 * page (its layout × the pixel ratio — the preset's layout, or the page's
 * own for As is), scaled down only past the encoder's largest frame
 * ({@link MAX_FRAME_MACROBLOCKS}), made even (H.264 needs even dimensions).
 * A zoomed tab is refused for a preset: its CSS px are not the layout's.
 */
export function outputFor(
  preset: RecordPreset,
  m: Pick<
    TabMeasure,
    "innerWidth" | "innerHeight" | "devicePixelRatio" | "zoom"
  >,
): SizeResult<{ width: number; height: number }> {
  if (preset.page !== null && Math.abs(m.zoom - 1) > 1e-3)
    return { ok: false, reason: "zoomed" };
  const page = preset.page ?? { width: m.innerWidth, height: m.innerHeight };
  const w = page.width * m.devicePixelRatio;
  const h = page.height * m.devicePixelRatio;
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const blocks = (a: number, b: number) =>
    Math.ceil(a / 16) * Math.ceil(b / 16);
  let scale = Math.min(1, Math.sqrt((MAX_FRAME_MACROBLOCKS * 256) / (w * h)));
  while (blocks(even(w * scale), even(h * scale)) > MAX_FRAME_MACROBLOCKS)
    scale -= 0.001;
  return {
    ok: true,
    value: { width: even(w * scale), height: even(h * scale) },
  };
}

/** Whether `preset` can record `m`'s tab, and why not. */
export function presetFit(
  preset: RecordPreset,
  m: TabMeasure,
): { ok: true } | { ok: false; reason: SizeRefusal } {
  if (preset.page !== null) {
    const bounds = windowBoundsFor(preset.page, m);
    if (!bounds.ok) return bounds;
  }
  const out = outputFor(preset, m);
  return out.ok ? { ok: true } : out;
}

/** A refusal, in the panel's words. */
export function sizeRefusalText(reason: SizeRefusal): string {
  switch (reason) {
    case "does-not-fit":
      return "Too big for this screen";
    case "zoomed":
      return "Reset the page zoom to 100%";
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}
