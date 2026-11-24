/**
 * The recorder's sizes: which page layout and which video size each preset
 * records, and the window bounds that give the tab that layout. Pure — the
 * shell's worker (`browser-extension/background.ts`) resizes with it, the
 * panel disables a preset it refuses, with the same reason.
 */

/** A recording size, as the panel's dropdown lists it (a closed list). */
export type RecordPresetId = "720p" | "1080p" | "1440p" | "vertical" | "as-is";

export interface RecordPreset {
  id: RecordPresetId;
  label: string;
  /** The page's CSS layout the window is resized to; `null`: kept as it is. */
  page: { width: number; height: number } | null;
  /** The video's size; `null`: the page's own physical size. */
  video: { width: number; height: number } | null;
}

const LANDSCAPE = { width: 1280, height: 720 };

export const RECORD_PRESETS: readonly RecordPreset[] = [
  {
    id: "720p",
    label: "720p",
    page: LANDSCAPE,
    video: { width: 1280, height: 720 },
  },
  {
    id: "1080p",
    label: "1080p",
    page: LANDSCAPE,
    video: { width: 1920, height: 1080 },
  },
  {
    id: "1440p",
    label: "1440p",
    page: LANDSCAPE,
    video: { width: 2560, height: 1440 },
  },
  {
    id: "vertical",
    label: "9:16",
    page: { width: 540, height: 960 },
    video: { width: 1080, height: 1920 },
  },
  { id: "as-is", label: "As is", page: null, video: null },
];

export const DEFAULT_RECORD_PRESET: RecordPresetId = "1080p";

export function recordPreset(id: RecordPresetId): RecordPreset {
  const preset = RECORD_PRESETS.find((p) => p.id === id);
  if (preset === undefined) throw new Error(`no record preset ${id}`);
  return preset;
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
export type SizeRefusal = "does-not-fit" | "zoomed" | "upscale";

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
 * The video size `preset` records `m`'s tab at: the preset's own, refused
 * when the page renders fewer physical pixels than it (a DPR-1 display at
 * 1080p would be an upscale); "As is" is the page's own physical size, made
 * even (H.264 needs even dimensions).
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
  if (preset.video === null || preset.page === null) {
    const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
    return {
      ok: true,
      value: {
        width: even(m.innerWidth * m.devicePixelRatio),
        height: even(m.innerHeight * m.devicePixelRatio),
      },
    };
  }
  const physical = preset.page.width * m.devicePixelRatio;
  if (preset.video.width > physical + 0.5)
    return { ok: false, reason: "upscale" };
  return { ok: true, value: preset.video };
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
      return "Doesn’t fit this screen";
    case "zoomed":
      return "Reset the page zoom to 100%";
    case "upscale":
      return "Needs a Retina display";
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}
