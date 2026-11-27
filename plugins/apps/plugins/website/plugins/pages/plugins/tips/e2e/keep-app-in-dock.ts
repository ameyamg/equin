// The tip "Native Mac applications": in the panel the equin menu-bar icon
// opens, hovering an app's tile offers a pin — Keep <App> in the Dock — and
// equin apps kept there launch as apps of their own.
//
// A one-off, not a tipVideo take: the pin acts on the real Mac (the helper
// writes the Dock's preferences), which a browser recording cannot show. So
// the film is composed from four full-screen screenshots of the real Mac,
// taken in order by the user (each 3456×2234, a Retina screen at 2×):
//
//   1. the panel open over the desktop — and, in the Dock, an equin app
//      pinned earlier, its Dock tooltip "equin Files" showing;
//   2. the pointer on Events' tile: its pin and "Keep Events in the Dock";
//   3. the pin pressed;
//   4. after: the pin gone from the tile.
//
// The camera pushes in on the panel, goes through 2 → 4 on the tile (a drawn
// pointer and a click ring say where the hand is: a screenshot carries no
// pointer), pulls back to the whole Mac, then
// pushes in on the Dock, where shot 1's "equin Files" tooltip is lifted back
// in over it: what an equin app in the Dock is. The Dock is the same in all
// four shots (Events did not appear in it), so the film never shows Events
// landing there. Fades from and to black, so the page's loop is clean.
//
//   ./equin run plugins/apps/plugins/website/plugins/pages/plugins/tips/e2e/keep-app-in-dock.ts \
//     --shots <1.png>,<2.png>,<3.png>,<4.png> [--preview | --stills t1,t2]

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { usage } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";
import {
  cameraMove,
  fade,
  cropLift,
  frameOn,
  html,
  image,
  ring,
  runFilm,
  shape,
  type AssetManifest,
  type CameraView,
  type Composition,
  type Easing,
  type Key,
  type Rect,
  type Vec2,
} from "@plugins/media/plugins/film/e2e";
import { readImageSize } from "@plugins/packages/plugins/image-size/core";
import { nextVersion } from "./internal/tip-video";

export const e2e = {
  kind: "tool",
  target: "none",
  writes: false,
  run: {
    manual: ["heavy"],
    why: "Renders one tip's video from screenshots (a 1080p60 film).",
  },
} satisfies E2eScript;

const SLUG = "keep-app-in-dock";
/** The screenshots' pixel size, and their scale: a Retina screen at 2×. */
const SHOT = { width: 3456, height: 2234 };
const DPR = 2;
/** The Mac's screen in CSS px: the world the camera moves over. */
const WORLD = { width: SHOT.width / DPR, height: SHOT.height / DPR };
/** The film's stage (rendered at 1920×1080). */
const STAGE = { width: 1280, height: 720 };
/**
 * Where the camera may look: the screen, widened to 16:9 around it. The
 * screen is taller than 16:9, so the whole Mac shows with dark bands either
 * side.
 */
const BOUNDS: Rect = (() => {
  const width = (WORLD.height * STAGE.width) / STAGE.height;
  return { x: (WORLD.width - width) / 2, y: 0, width, height: WORLD.height };
})();
const BACKGROUND = "#0b0d12";

/** What the camera frames, in the screen's CSS px (measured on the shots). */
const PANEL: Rect = { x: 1132, y: 39, width: 358, height: 605 };
const APPS: Rect = { x: 1140, y: 229, width: 342, height: 302 };
/** Events' tile, and the pin on its corner, where shot 3 presses it. */
const EVENTS_TILE: Vec2 = [1268, 345];
const PIN: Vec2 = [1283, 362];
/** The Dock from its middle to its end, with shot 1's "equin Files" tooltip above its tile. */
const DOCK: Rect = { x: 640, y: 984, width: 725, height: 132 };
/** Shot 1's Dock tooltip: the only part of the Dock that differs between the shots. */
const DOCK_TOOLTIP: Rect = { x: 935, y: 984, width: 132, height: 50 };

const REST: CameraView = frameOn(BOUNDS, {
  stage: STAGE,
  bounds: BOUNDS,
  margin: 0,
  maxZoom: 4,
});
/** A push-in stays on the screen: the bands show only in the whole-Mac view. */
const SCREEN: Rect = { x: 0, y: 0, ...WORLD };
const on = (r: Rect, margin: number, maxZoom: number): CameraView =>
  frameOn(r, { stage: STAGE, bounds: SCREEN, margin, maxZoom });

const PUSH_IN: Easing = { bezier: [0.42, 0, 0.18, 1] };
const PULL_OUT: Easing = { bezier: [0.4, 0, 0.25, 1] };
const LOOP_FADE = 0.3;

/** The film's beats, in seconds. */
const T = {
  pushPanel: [0.9, 1.9],
  pointerIn: [1.6, 2.5],
  hover: 2.5, // shot 2
  pushApps: [2.6, 3.5],
  toPin: [3.5, 3.95],
  click: 4.2, // shot 3
  after: 5.0, // shot 4
  pointerOut: 6.0,
  pullOut: [6.3, 7.1],
  pushDock: [7.7, 8.6],
  dockTooltip: 8.8, // shot 1's tooltip, over the Dock
  pullBack: [10.2, 11.0],
  end: 11.6,
} as const;

const assetsDir = mkdtempSync(join(tmpdir(), `tip-${SLUG}-`));
try {
  await runFilm({
  name: `tip-${SLUG}`,
  out: (ctx) => nextVersion(SLUG, ctx.preview),
  web: true,
  options: {
    shots: "the four screenshots, in order, comma-separated (see the header)",
  },
  build: (ctx) => build(ctx.option("shots")),
  });
} finally {
  // The copies of the screenshots go with the render.
  rmSync(assetsDir, { recursive: true, force: true });
}

function build(shots: string | undefined): Composition {
  const files = shots?.split(",") ?? [];
  if (files.length !== 4)
    usage(
      `tips: --shots takes the four screenshots, in order (got ${files.length})`,
    );
  const dir = assetsDir;
  const m: AssetManifest = {
    dpr: DPR,
    width: WORLD.width,
    height: WORLD.height,
    stills: {},
    rects: {},
    sequences: {},
    strips: {},
    stripRects: {},
    audio: {},
  };
  files.forEach((file, i) => {
    const read = readImageSize(readFileSync(file));
    if (
      read.kind !== "size" ||
      read.size.width !== SHOT.width ||
      read.size.height !== SHOT.height
    )
      throw new Error(
        `tips: ${file} is not a ${SHOT.width}×${SHOT.height} screenshot (${read.kind === "size" ? `${read.size.width}×${read.size.height}` : read.kind}) — the framings are measured on that size`,
      );
    copyFileSync(file, join(dir, `shot${i + 1}.png`));
    m.stills[`shot${i + 1}`] = {
      file: `shot${i + 1}.png`,
      x: 0,
      y: 0,
      ...WORLD,
    };
  });

  // The camera: whole Mac → panel → its apps → whole Mac → Dock → whole Mac.
  const views: [readonly [number, number], CameraView, CameraView, Easing][] =
    [];
  const panel = on(PANEL, 20, 1.4);
  const apps = on(APPS, 28, 1.45);
  const dock = on(DOCK, 20, 1.6);
  views.push([T.pushPanel, REST, panel, PUSH_IN]);
  views.push([T.pushApps, panel, apps, PUSH_IN]);
  views.push([T.pullOut, apps, REST, PULL_OUT]);
  views.push([T.pushDock, REST, dock, PUSH_IN]);
  views.push([T.pullBack, dock, REST, PULL_OUT]);
  const focus: Key<Vec2>[] = [[0, REST.focus]];
  const zoom: Key[] = [[0, REST.zoom]];
  for (const [[t0, t1], from, to, easing] of views) {
    const mv = cameraMove(t0, t1, from, to, { stage: STAGE, easing });
    focus.push(...mv.focus);
    zoom.push(...mv.zoom);
  }

  // The pointer a screenshot does not carry: in, onto the tile, onto the
  // pin, a press, and away.
  const pointer = html(
    `<svg width="17" height="25" viewBox="0 0 17 25" xmlns="http://www.w3.org/2000/svg"><path d="M1 1 L1 19.5 L5.6 15.3 L8.6 22.6 L11.6 21.3 L8.7 14.2 L14.8 14.2 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
    17,
    25,
    {
      id: "pointer",
      x: [
        [T.pointerIn[0], 1090],
        [T.pointerIn[1], EVENTS_TILE[0], "inOutCubic"],
        [T.toPin[0], EVENTS_TILE[0]],
        [T.toPin[1], PIN[0] - 2, "inOutCubic"],
      ],
      y: [
        [T.pointerIn[0], 610],
        [T.pointerIn[1], EVENTS_TILE[1], "inOutCubic"],
        [T.toPin[0], EVENTS_TILE[1]],
        [T.toPin[1], PIN[1] - 2, "inOutCubic"],
      ],
      // The press, from the arrow's tip.
      origin: [1, 1],
      scale: [
        [T.click - 0.08, 1],
        [T.click, 0.86, "outQuad"],
        [T.click + 0.16, 1, "outQuad"],
      ],
      opacity: fade(T.pointerIn[0], 0.25, T.pointerOut, 0.3),
      style: { filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,.45))" },
    },
  );
  const clickRing = ring(
    { x: PIN[0] - 9, y: PIN[1] - 9, width: 18, height: 18 },
    {
      id: "click",
      pad: 0,
      radius: 9,
      color: "rgba(255,255,255,0.9)",
      thickness: 2,
      glow: 6,
      start: T.click,
      end: T.click + 0.6,
      scale: [
        [T.click, 0.6],
        [T.click + 0.55, 2.2, "outCubic"],
      ],
      opacity: [
        [T.click, 0.9],
        [T.click + 0.55, 0, "outQuad"],
      ],
    },
  );

  const black = (opacity: Key[]) =>
    shape(
      { kind: "rect", width: STAGE.width, height: STAGE.height, fill: "#000" },
      { opacity },
    );
  return {
    width: STAGE.width,
    height: STAGE.height,
    duration: T.end,
    background: BACKGROUND,
    assets: { dir, manifest: m },
    camera: {
      focus,
      zoom,
      bounds: [BOUNDS.x, BOUNDS.y, BOUNDS.width, BOUNDS.height],
      motionBlur: false,
    },
    layers: [
      image("shot1"),
      image("shot2", { opacity: fade(T.hover, 0.25) }),
      image("shot3", { opacity: fade(T.click, 0.12) }),
      image("shot4", { opacity: fade(T.after, 0.3) }),
      clickRing,
      pointer,
      cropLift(m, "shot1", DOCK_TOOLTIP, {
        opacity: fade(T.dockTooltip, 0.3),
      }),
    ],
    // The video loops on the tips page: from black and back to it.
    overlay: [
      black([
        [0, 1],
        [LOOP_FADE, 0, "inOutSine"],
      ]),
      black(fade(T.end - LOOP_FADE, LOOP_FADE)),
    ],
  };
}

