/**
 * What the extension adds to a recorded video around the pointer, read from
 * the video's own frames: a headed Chromium with this checkout's built
 * extension records a tab while the page is pointed at and clicked
 * (Playwright's input — trusted events to the page, the OS cursor never
 * moved), once with Clicks on and once off, and cuts frames out of each video
 * into `--out`:
 *
 * - **No pointer of ours**: Chrome's tab capture composites the real OS
 *   cursor itself (content/browser/media/capture/mouse_cursor_overlay_
 *   controller*: always on, shown on native mouse movement, hidden after 2 s
 *   still), so the extension draws none — the frame where the pointer rests
 *   on an empty area holds no dark pixels there.
 * - **Clicks on**: a click shows a ripple, and it is gone half a second later
 *   (no dot left on the video). **Clicks off**: no ripple at all.
 * - **One overlay**: the page holds at most one recorder overlay while it
 *   records (an in-page navigation re-injects the content script; the new
 *   one must take over, never leave the old one drawing), none after.
 *
 *   ./equin run plugins/companions/plugins/browser-extension/plugins/recorder/e2e/cursor-probe.ts --headed --out <dir>
 *
 * Why this exists: 2026-11-25, the user's videos showed two cursors, the
 * Pointer toggle changed nothing, and click ripples stayed as dots. Two
 * causes: the extension drew an arrow over the OS cursor Chrome already
 * captures, and every re-injection of the content script (the worker
 * re-injects on each `complete` of the tab — an in-page navigation too)
 * orphaned the previous one, which kept drawing whatever the toggle said.
 * The frames before the fix showed both. Never move the real OS cursor from
 * a probe: it is the person's.
 */
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  arg,
  flag,
  pathUrl,
  report,
  targetNamespace,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import { ensureDepViaCli } from "@plugins/infra/plugins/deps/deps";
import { launchPersistentChromium } from "@plugins/infra/plugins/deps/plugins/playwright-browser/deps";
import { chromium } from "@plugins/infra/plugins/safe-fetch/plugins/browser-fetch/deps";
import { resolveFfmpeg } from "@plugins/media/plugins/ffmpeg/deps";
import { spawnExpectOk } from "@plugins/infra/plugins/spawn/core";
import {
  EXTENSION_ID,
  type RecorderState,
} from "@plugins/companions/plugins/browser-extension/core";
import {
  browserExtensionRoot,
  SHELL_FOLDER,
} from "@plugins/companions/plugins/browser-extension/data-dirs";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";
import { readCursorTrack } from "../core";

export const e2e = {
  kind: "test",
  target: "build",
  writes: true,
  run: {
    manual: ["native-helper", "interactive"],
    why: "Loads this checkout's built browser extension into a headed Chromium, records a tab while Playwright points and clicks in it (the OS cursor is never moved), and writes the videos' frames into --out (the recordings are removed from the Recordings folder after).",
  },
} satisfies E2eScript;

const TIMEOUT_MS = 60_000;
const W = 1280;
const H = 720;

const r = report("recorder: the pointer and clicks in the video");
if (!flag("headed"))
  throw new Error("Run it --headed: tab capture of a real window.");
const out = arg("out");
if (out === undefined) throw new Error("--out <dir>: where the frames go.");
await mkdir(out, { recursive: true });

const shell = join(browserExtensionRoot(targetNamespace()), SHELL_FOLDER);
const installed = await ensureDepViaCli(chromium, {
  stdio: "inherit",
  grant: null,
});
const profile = await mkdtemp(join(tmpdir(), "equin-extension-cursor-"));
const context = await launchPersistentChromium(installed, profile, {
  signals: "playwright",
  headless: false,
  viewport: null,
  args: [
    `--disable-extensions-except=${shell}`,
    `--load-extension=${shell}`,
    `--allowlisted-extension-id=${EXTENSION_ID}`,
  ],
});
const ff = await resolveFfmpeg();

const FPS = 5;
/** Every frame of `video`, FPS a second, as RGB bytes (1280 × 720). */
async function framesOf(video: string): Promise<Uint8Array[]> {
  const rawPath = `${video}.rgb`;
  await spawnExpectOk(
    [
      ff.ffmpeg,
      "-v",
      "error",
      "-i",
      video,
      "-vf",
      // The video is the page's every physical pixel (layout × DPR: 2560 ×
      // 1440 on a Retina display); the boxes below are in the page's CSS px.
      `fps=${FPS},scale=${W}:${H}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-y",
      rawPath,
    ],
    { timeoutMs: 60_000 },
  );
  const all = new Uint8Array(await readFile(rawPath));
  await rm(rawPath);
  const size = W * H * 3;
  const frames: Uint8Array[] = [];
  for (let at = 0; at + size <= all.length; at += size)
    frames.push(all.subarray(at, at + size));
  return frames;
}

/** The most pixels matching `test` in `box` over the frames of [from, to] s:
 *  the video starts a little before the worker says it records, so a moment
 *  is read as a window, never one frame. */
function most(
  frames: Uint8Array[],
  from: number,
  to: number,
  box: { x: number; y: number; w: number; h: number },
  test: (r: number, g: number, b: number) => boolean,
): number {
  let max = 0;
  for (
    let i = Math.max(0, Math.floor(from * FPS));
    i <= Math.min(frames.length - 1, Math.ceil(to * FPS));
    i++
  )
    max = Math.max(max, count(frames[i]!, box, test));
  return max;
}

/** Pixels in a box of a frame matching `test`. */
function count(
  px: Uint8Array,
  box: { x: number; y: number; w: number; h: number },
  test: (r: number, g: number, b: number) => boolean,
): number {
  let n = 0;
  const [x0, y0] = [Math.round(box.x), Math.round(box.y)];
  for (let y = Math.max(0, y0); y < Math.min(H, y0 + box.h); y++)
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + box.w); x++) {
      const i = (y * W + x) * 3;
      if (test(px[i]!, px[i + 1]!, px[i + 2]!)) n++;
    }
  return n;
}
/** The ripple's tint (the accent at 35%, fading): redder than blue — the
 *  page's greys are bluish. */
const isAccent = (R: number, _G: number, B: number) => R > 150 && R - B > 15;
const isDark = (R: number, G: number, B: number) => R + G + B < 200;
const WHOLE = { x: 0, y: 0, w: W, h: H };

const saved: string[] = [];
try {
  const tab = context.pages()[0] ?? (await context.newPage());
  const tabUrl = pathUrl("/home/browser-extension");
  await tab.goto(tabUrl);
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${EXTENSION_ID}/permissions.html`);
  await tab.bringToFront();

  type Chrome = {
    tabs: { query: (q: object) => Promise<{ id?: number }[]> };
    runtime: {
      sendMessage: (m: unknown) => Promise<unknown>;
      getManifest: () => { version_name: string };
    };
    storage: {
      onChanged: {
        addListener: (
          f: (changes: Record<string, { newValue?: unknown }>) => void,
        ) => void;
      };
    };
  };
  await ext.evaluate(() => {
    const c = (globalThis as unknown as { chrome: Chrome }).chrome;
    const w = window as unknown as { states: unknown[] };
    w.states = [];
    c.storage.onChanged.addListener((changes) => {
      const next = changes["recorder.state"]?.newValue;
      if (next !== undefined) w.states.push(next);
    });
  });
  const states = () =>
    ext.evaluate(
      () => (window as unknown as { states: RecorderState[] }).states,
    );
  const until = async (kind: RecorderState["kind"], from: number) => {
    await ext.waitForFunction(
      ({ k, from }) =>
        (window as unknown as { states: { kind: string }[] }).states
          .slice(from)
          .some((s) => s.kind === k || s.kind === "idle"),
      { k: kind, from },
      { timeout: TIMEOUT_MS },
    );
    const found = (await states()).slice(from).find((s) => s.kind === kind);
    if (found === undefined)
      throw new Error(
        `the worker never reached ${kind}: ${JSON.stringify(await states())}`,
      );
    return found;
  };
  const send = (message: unknown) =>
    ext.evaluate((m) => {
      const c = (globalThis as unknown as { chrome: Chrome }).chrome;
      return c.runtime.sendMessage({
        ...(m as object),
        equinShellBuild: c.runtime.getManifest().version_name,
      });
    }, message);
  const overlays = () =>
    tab.evaluate(
      () =>
        // A hidden stale one (a build's before the fix) does not draw.
        document.querySelectorAll("equin-recorder:not([data-equin-stale])")
          .length,
    );

  const take = async (label: string, clicks: boolean) => {
    const from = (await states()).length;
    const reply = await ext.evaluate(
      async ({ url, clicks }) => {
        const c = (globalThis as unknown as { chrome: Chrome }).chrome;
        const [target] = await c.tabs.query({ url });
        if (target?.id === undefined) throw new Error(`no tab at ${url}`);
        return c.runtime.sendMessage({
          equinShellBuild: c.runtime.getManifest().version_name,
          type: "recorder.start",
          tabId: target.id,
          options: {
            preset: "720p",
            tabAudio: false,
            mic: false,
            clicks,
            countdown: false,
            // The option's name before 2026-11-25 (`pointer`), so the same
            // probe records the build before the fix.
            pointer: clicks,
          },
        });
      },
      { url: tabUrl, clicks },
    );
    r.eq(`${label}: the worker took the start`, reply, { ok: true });
    await until("recording", from);
    const t0 = Date.now();
    const at = () => (Date.now() - t0) / 1000;
    await tab.bringToFront();

    // An in-page navigation: Chrome reports the tab `complete` again, and
    // the worker re-injects the content script.
    await tab.evaluate(() => history.pushState(null, "", location.href));
    await tab.waitForTimeout(500);

    // Sweep, then rest on an empty area (top left, nothing drawn there).
    await tab.mouse.move(W * 0.6, H * 0.6);
    await tab.mouse.move(W * 0.12, H * 0.15, { steps: 30 });
    await tab.waitForTimeout(600);
    const restAt = at();
    await tab.waitForTimeout(600);
    const during = await overlays();

    // Three clicks on empty areas; the last one's frame is read right after.
    for (const [fx, fy] of [
      [0.12, 0.85],
      [0.5, 0.85],
      [0.88, 0.85],
    ] as const) {
      await tab.mouse.click(W * fx, H * fy);
      await tab.waitForTimeout(400);
    }
    await tab.mouse.move(W * 0.88, H * 0.15, { steps: 5 });
    await tab.waitForTimeout(1500);
    const settledAt = at();
    await tab.waitForTimeout(800);
    await send({ type: "recorder.stop" });
    const last = await until("idle", from);
    if (last.kind !== "idle" || last.last?.kind !== "saved")
      throw new Error(`${label}: not saved: ${JSON.stringify(last)}`);
    const video = last.last.recording.path;
    saved.push(video);
    await copyFile(video, join(out, `${label}.mp4`));
    await spawnExpectOk(
      [
        ff.ffmpeg,
        "-v",
        "error",
        "-y",
        "-i",
        video,
        "-vf",
        "fps=4",
        join(out, `${label}-%02d.png`),
      ],
      { timeoutMs: 60_000 },
    );

    r.ok(
      `${label}: ${clicks ? "one overlay" : "no overlay"} while recording (an in-page navigation re-injected the script)`,
      during === (clicks ? 1 : 0),
      `${during} overlays`,
    );
    r.eq(`${label}: no overlay left after stop`, await overlays(), 0);

    const frames = await framesOf(video);
    const restDark = most(
      frames,
      restAt - 0.2,
      restAt + 0.8,
      { x: W * 0.12 - 8, y: H * 0.15 - 8, w: 40, h: 40 },
      isDark,
    );
    r.eq(`${label}: no pointer drawn where the mouse rests`, restDark, 0);

    // The last click's time on the video's clock, from the pointer track
    // inside the video — the probe's own clock reads it late on a loaded
    // host (each Playwright call waits its turn), past the ripple's 500 ms.
    const read = await readCursorTrack(Bun.file(video));
    const downs =
      read.kind === "found"
        ? read.track.samples.filter((s) => s[3] === "down")
        : [];
    r.eq(
      `${label}: the track inside the video holds the 3 clicks`,
      downs.length,
      3,
    );
    const clickAt = (downs.at(-1)?.[0] ?? 0) / 1000;
    const ripple = most(
      frames,
      clickAt - 0.2,
      clickAt + 0.6,
      { x: W * 0.88 - 30, y: H * 0.85 - 30, w: 60, h: 60 },
      isAccent,
    );
    if (clicks)
      r.ok(`${label}: a click shows a ripple`, ripple > 20, `${ripple} px`);
    else r.eq(`${label}: Clicks off: no ripple`, ripple, 0);

    const settled = most(frames, settledAt, settledAt + 2, WHOLE, isAccent);
    r.eq(`${label}: no click mark left on the video after`, settled, 0);
  };

  await take("clicks-on", true);
  await take("clicks-off", false);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
  for (const path of saved) {
    await rm(path, { force: true });
  }
}
await r.finish();
