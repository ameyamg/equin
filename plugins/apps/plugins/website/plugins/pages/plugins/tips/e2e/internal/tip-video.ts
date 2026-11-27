// A tip's video: one recorded take of the real app on this checkout's seeded
// promo-film composition (made-up data, never the user's own records),
// rendered by media/film at 1080p60 with a camera that pushes in on what the
// tip is about and back out, the pointer drawn over it (with a key cap beside
// it while a modifier is held), faded in and out so it loops cleanly — and its
// web version, the file a tip carries. Every render is a new version, never an
// overwrite. How to write a tip's script: this plugin's CLAUDE.md.
//
//   ./equin run plugins/apps/plugins/website/plugins/pages/plugins/tips/e2e/<slug>.ts --composition promo-film
//     [--rec-dir <dir>]           keep the take there (default: a fresh temp dir, printed)
//     [--render-only]             render the take already in --rec-dir, record nothing
//     [--preview | --stills t1,t2]  media/film's review modes

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import {
  arg,
  flag,
  pathUrl,
  usage,
  withBrowser,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import {
  cameraMove,
  fade,
  frameOn,
  installRecorderClock,
  record,
  recordedCursor,
  recordedKeyCaps,
  recordedSfx,
  runFilm,
  sequence,
  shape,
  type AssetManifest,
  type CameraView,
  type Composition,
  type Easing,
  type Key,
  type Recorder,
  type Rect,
  type Sequence,
  type Value,
  type Vec2,
} from "@plugins/media/plugins/film/e2e";
import { HOME_DIR } from "@plugins/infra/plugins/paths/plugins/data-root-layout/core";
import {
  FILM_CLOCK_FILE,
  FilmClockSchema,
} from "@plugins/apps/plugins/website/plugins/promo-film/plugins/seed/core";
import { promoFilmWorkspaceDir } from "@plugins/apps/plugins/website/plugins/promo-film/plugins/seed/data-dirs";

/** The capture viewport (CSS px) and the film's stage: 16:9, the tips card's aspect. */
const W = 1280;
const H = 720;
/**
 * Recorded at 3×: a 3840×2160 frame keeps a 2× push-in at the 1080p film's
 * own resolution (1920 px of film from 1920 px of capture).
 */
const DPR = 3;
const FPS = 60;
const STAGE = { width: W, height: H };
const REST: CameraView = { focus: [W / 2, H / 2], zoom: 1 };
/** A push-in asks the viewer to look closer: a soft start, a long settle. */
const PUSH_IN: { dur: number; easing: Easing } = {
  dur: 0.9,
  easing: { bezier: [0.42, 0, 0.18, 1] },
};
/** The pull-back is quicker. */
const PULL_OUT: { dur: number; easing: Easing } = {
  dur: 0.7,
  easing: { bezier: [0.4, 0, 0.25, 1] },
};
/** How many frames a focus waits for its target to appear. */
const APPEAR_FRAMES = 300;
/** The still beats before and after the script, under the loop's fades. */
const LEAD_IN = 0.6;
const TAIL = 0.9;
const LOOP_FADE = 0.3;
/** Where the tips' versions are written. */
const OUT_DIR = join(HOME_DIR, "Downloads/tips");

export interface TipVideo {
  /** Names the take and the files: `<slug>-v<N>.mp4` and `<slug>-v<N>-web.mp4`. */
  slug: string;
  /** The app route the take opens on (loaded in real time, before recording). */
  path: string;
  /** Default dark: the website's own scheme. */
  colorScheme?: "dark" | "light";
  /**
   * Real-time set-up after the route has booted and before the first frame:
   * wait for what the first gesture reaches for, set browser-local state.
   */
  prepare?(page: Page): Promise<void>;
  /** Where the pointer starts (default: the viewport centre). */
  cursor?: { x: number; y: number };
  /** The take: every gesture, hold and camera move, on the recorder's clock. */
  script(r: TipRecorder): Promise<void>;
}

/** What a tip's script may push the camera onto: an element's settled box, or a rect it measured. */
export type FocusTarget = Locator | Rect;

/** media/film's recorder, plus the camera. */
export interface TipRecorder extends Recorder {
  /**
   * Push the camera in, from now, onto `targets` — the union of their
   * boxes, each read where it will be once running animations end (a menu
   * still opening) — grown by `margin` (default 32 px), as close as
   * `maxZoom` (default 2) allows. From a framing already in, it pans and
   * zooms onto the new one. The script goes on at once: the camera moves
   * while the hand does (hold, if the viewer should wait for it).
   */
  focus(
    targets: FocusTarget | readonly FocusTarget[],
    opts?: { margin?: number; maxZoom?: number; duration?: number },
  ): Promise<void>;
  /**
   * Pull the camera back to the whole screen, from now. A camera move's
   * `duration` is film time: under `clockRate` it does not slow with the page.
   */
  unfocus(opts?: { duration?: number }): Promise<void>;
}

/** One camera move of a take, as the film places it (`<slug>.camera.json`). */
interface CameraStep {
  t0: number;
  t1: number;
  from: CameraView;
  to: CameraView;
  easing: Easing;
}

const tipOptions = {
  "rec-dir":
    "where the take is (and is recorded to): frames, input log, camera moves",
};
const tipFlags = {
  "render-only": "render the take already in --rec-dir; record nothing",
};

/** Record a tip's take (unless --render-only), then render its film and web version. */
export async function tipVideo(tip: TipVideo): Promise<void> {
  const renderOnly = flag("render-only");
  const given = arg("rec-dir");
  if (renderOnly && given === undefined)
    usage("tips: --render-only renders the take in --rec-dir <dir>: name it");
  const dir = given ?? mkdtempSync(join(tmpdir(), `tip-${tip.slug}-`));
  console.log(`tips: the take is in ${dir}`);
  if (!renderOnly) await recordTake(tip, dir);
  await runFilm({
    name: `tip-${tip.slug}`,
    out: (ctx) => nextVersion(tip.slug, ctx.preview),
    web: true,
    flags: tipFlags,
    options: tipOptions,
    build: () => buildFilm(tip.slug, dir),
  });
}

/** The film's calendar: the seed's weekday afternoon, which its story's "x ago" are stamped from. */
function seedDate(): number {
  const file = promoFilmWorkspaceDir.file(FILM_CLOCK_FILE);
  if (!existsSync(file))
    throw new Error(
      `tips: no film clock at ${file} — run ./equin promo-film seed first (the tips are recorded on its data)`,
    );
  return FilmClockSchema.parse(JSON.parse(readFileSync(file, "utf8"))).now;
}

async function recordTake(tip: TipVideo, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  for (const f of [`${tip.slug}.json`, `${tip.slug}.camera.json`])
    if (existsSync(join(dir, f)))
      usage(
        `tips: ${join(dir, f)} exists — a take is never recorded over another: a new --rec-dir, or --render-only to render it`,
      );
  await withBrowser(
    async (h) => {
      const { page, context } = await h.session({
        viewport: { width: W, height: H },
        deviceScaleFactor: DPR,
        colorScheme: tip.colorScheme ?? "dark",
        capture: false,
      });
      await installRecorderClock(context, { date: seedDate() });
      await page.goto(pathUrl(tip.path), { waitUntil: "load" });
      await page.waitForFunction(
        () =>
          document.title.includes(" — ") &&
          document.body.innerText.trim().length > 20,
        undefined,
        { timeout: 60_000 },
      );
      // Fonts, icons and the deferred plugins land in real time, unrecorded.
      await page.waitForTimeout(2500);
      await tip.prepare?.(page);
      const steps: CameraStep[] = [];
      await record(
        page,
        {
          dir,
          name: tip.slug,
          fps: FPS,
          cursor: tip.cursor,
          settle: { timeoutMs: 120_000 },
        },
        async (rec) => {
          const r = withCamera(rec, steps);
          await rec.hold(LEAD_IN);
          await tip.script(r);
          const last = steps[steps.length - 1];
          // The camera's last move plays out before the tail starts.
          if (last && last.t1 > rec.t) await rec.hold(last.t1 - rec.t);
          await rec.hold(TAIL);
        },
      );
      writeFileSync(
        join(dir, `${tip.slug}.camera.json`),
        JSON.stringify(steps, null, 1),
      );
    },
    {
      // A blinking caret runs on the browser's real clock: it would flicker
      // across the virtual clock's frames.
      steadyCaret: true,
    },
  );
}

/** The recorder with the camera's focus / unfocus, logging each move into `steps`. */
function withCamera(rec: Recorder, steps: CameraStep[]): TipRecorder {
  const current = (): CameraView => steps[steps.length - 1]?.to ?? REST;
  const begin = (to: CameraView, dur: number, easing: Easing): void => {
    const last = steps[steps.length - 1];
    if (last && rec.t < last.t1 - 1e-6)
      throw new Error(
        `tips: a camera move at ${rec.t.toFixed(2)} s starts before the one before it ends (${last.t1.toFixed(2)} s) — hold until it has`,
      );
    steps.push({ t0: rec.t, t1: rec.t + dur, from: current(), to, easing });
  };
  const box = async (t: FocusTarget): Promise<Rect> => {
    if ("x" in t && typeof t.x === "number") return t as Rect;
    const loc = t as Locator;
    // Not on the page yet (a popover the last click opens): it can only
    // appear as the page's clock runs, so wait for it frame by frame, as the
    // recorder waits for a gesture's target.
    for (let i = 0; (await loc.count()) === 0; i++) {
      if (i >= APPEAR_FRAMES)
        throw new Error(
          `tips: focus on ${String(loc)}: not on the page after ${APPEAR_FRAMES / FPS} s`,
        );
      await rec.hold(1 / FPS);
    }
    const b = await rec.settledBox(loc);
    if (!(b.width > 0 && b.height > 0))
      throw new Error(
        `tips: focus on ${String(loc)}: it draws no box (hidden?) — the camera would frame nothing`,
      );
    return b;
  };
  const r: TipRecorder = Object.assign(Object.create(rec) as Recorder, {
    async focus(
      targets: FocusTarget | readonly FocusTarget[],
      o: { margin?: number; maxZoom?: number; duration?: number } = {},
    ) {
      const list = (
        Array.isArray(targets) ? targets : [targets]
      ) as FocusTarget[];
      if (list.length === 0) throw new Error("tips: focus on nothing");
      // One after another: a box still waiting for its target captures
      // frames, and two such waits at once would capture over each other.
      const boxes: Rect[] = [];
      for (const t of list) boxes.push(await box(t));
      const x0 = Math.min(...boxes.map((b) => b.x));
      const y0 = Math.min(...boxes.map((b) => b.y));
      const x1 = Math.max(...boxes.map((b) => b.x + b.width));
      const y1 = Math.max(...boxes.map((b) => b.y + b.height));
      const view = frameOn(
        { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
        { stage: STAGE, margin: o.margin ?? 32, maxZoom: o.maxZoom ?? 2 },
      );
      begin(view, o.duration ?? PUSH_IN.dur, PUSH_IN.easing);
    },
    async unfocus(o: { duration?: number } = {}) {
      begin(REST, o.duration ?? PULL_OUT.dur, PULL_OUT.easing);
    },
  });
  return r;
}

/** The take, as a film: frames under the camera, the pointer and key caps over them, faded at both ends. */
function buildFilm(slug: string, dir: string): Composition {
  const file = join(dir, `${slug}.json`);
  const camFile = join(dir, `${slug}.camera.json`);
  if (!existsSync(file) || !existsSync(camFile))
    throw new Error(
      `tips: no take "${slug}" in ${dir} — record it (drop --render-only)`,
    );
  const seq = JSON.parse(readFileSync(file, "utf8")) as Sequence;
  const steps = JSON.parse(readFileSync(camFile, "utf8")) as CameraStep[];
  const m: AssetManifest = {
    dpr: DPR,
    width: W,
    height: H,
    stills: {},
    rects: {},
    sequences: { [slug]: seq },
    strips: {},
    stripRects: {},
    audio: {},
  };
  const duration = seq.frames.length / (seq.fps ?? FPS);
  const focus: Key<Vec2>[] = [[0, REST.focus]];
  const zoom: Key[] = [[0, REST.zoom]];
  for (const s of steps) {
    const mv = cameraMove(s.t0, s.t1, s.from, s.to, {
      stage: STAGE,
      easing: s.easing,
    });
    focus.push(...mv.focus);
    zoom.push(...mv.zoom);
  }
  const black = (opacity: Key[]) =>
    shape({ kind: "rect", width: W, height: H, fill: "#000" }, { opacity });
  return {
    width: W,
    height: H,
    duration,
    background: "#000",
    assets: { dir, manifest: m },
    camera: {
      focus: dedupe(focus),
      zoom: dedupe(zoom),
      bounds: [0, 0, W, H],
      motionBlur: false,
    },
    layers: [
      sequence(slug),
      ...recordedKeyCaps(m, slug),
      recordedCursor(m, slug),
    ],
    // The video loops on the tips page: from black and back to it.
    overlay: [
      black([
        [0, 1],
        [LOOP_FADE, 0, "inOutSine"],
      ]),
      black(fade(duration - LOOP_FADE, LOOP_FADE)),
    ],
    audio: { sfx: recordedSfx(m, slug) },
  };
}

/** Keys at the same instant (a move starting where the rest key is) keep the later one. */
function dedupe<V extends Value>(keys: Key<V>[]): Key<V>[] {
  const out: Key<V>[] = [];
  for (const k of keys) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev[0] - k[0]) < 1e-9) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}

/** `<slug>-v<N>.mp4` with N one past the newest version (a preview: `-preview` of the one about to be made). */
export function nextVersion(slug: string, preview: boolean): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(OUT_DIR);
  const re = new RegExp(`^${slug}-v(\\d+)(-preview(-\\d+)?)?\\.mp4$`);
  const versions = files
    .map((f) => re.exec(f))
    .filter((x): x is RegExpExecArray => x !== null && x[2] === undefined)
    .map((x) => Number(x[1]));
  const n = versions.length ? Math.max(...versions) + 1 : 1;
  const base = `${slug}-v${n}`;
  if (!preview) return join(OUT_DIR, `${base}.mp4`);
  for (let k = 1; ; k++) {
    const name = k === 1 ? `${base}-preview.mp4` : `${base}-preview-${k}.mp4`;
    if (!files.includes(name)) return join(OUT_DIR, name);
  }
}
