/**
 * The recorder's whole session, as the service worker runs it: Chromium with
 * this checkout's built shell, a tab on this deploy in a window of another
 * size, and `recorder.start` sent to the worker as the popup sends it — so the
 * real path runs: measure, un-maximize and resize the window to the preset's
 * layout, count down, take a `tabCapture` stream id, start the offscreen
 * MediaRecorder, upload through the relay page. Twice:
 *
 * 1. Stop after a few seconds: it was still recording, and the file is a
 *    1920 × 1080 H.264 video holding those seconds.
 * 2. Resize the window mid-recording: it stops on its own, the video kept,
 *    and the state says why (`stoppedBy: "window-resized"`), for the panel.
 *
 *   ./equin run plugins/companions/plugins/browser-extension/plugins/recorder/e2e/session-probe.ts [--headed]
 *
 * Chrome grants `tabCapture` only after a click on the extension; Chromium's
 * `--allowlisted-extension-id` grants it to this extension without one (the
 * capture is the same; only the gesture is skipped). Headed only: the
 * maximized window is the real display's.
 *
 * Why this exists: 2026-11-25, in the user's Chrome every recording stopped as
 * the countdown ended ("the recording has no chunk", 409 from finish). The
 * extension's own un-maximize and resize queued `windows.onBoundsChanged`
 * events behind the start; they ran once it was recording, each carrying the
 * window's bounds from when it fired, and the "manual resize stops" rule took
 * them for a resize. The stop came before the recorder's first chunk, and the
 * reason was lost behind the finish's 409. `record-probe.ts` drives the relay
 * alone and could not see it; this probe failed on that code.
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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
  type SavedRecording,
} from "@plugins/companions/plugins/browser-extension/core";
import {
  browserExtensionRoot,
  SHELL_FOLDER,
} from "@plugins/companions/plugins/browser-extension/data-dirs";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";

export const e2e = {
  kind: "test",
  target: "build",
  writes: true,
  run: {
    manual: ["native-helper", "interactive"],
    why: "Loads this checkout's built browser extension unpacked into a headed Chromium (a maximized window on the real display), records a tab for a few seconds and writes the video into the Recordings folder (removed after).",
  },
} satisfies E2eScript;

const TIMEOUT_MS = 60_000;
/** How long the probe records: several of the recorder's 1 s chunks. */
const RECORD_MS = 4_000;

const r = report("browser extension recorder session");
const shell = join(browserExtensionRoot(targetNamespace()), SHELL_FOLDER);
const installed = await ensureDepViaCli(chromium, {
  stdio: "inherit",
  grant: null,
});
const profile = await mkdtemp(join(tmpdir(), "equin-extension-session-"));
const context = await launchPersistentChromium(installed, profile, {
  signals: "playwright",
  headless: false,
  // The window's own size, not an emulated viewport: the worker resizes it.
  viewport: null,
  args: [
    `--disable-extensions-except=${shell}`,
    `--load-extension=${shell}`,
    `--allowlisted-extension-id=${EXTENSION_ID}`,
    // A Retina display, as the user's: 1080p is a layout at DPR 2.
    "--force-device-scale-factor=2",
    // Maximized, as the user's window was: the start un-maximizes and
    // resizes it, the events of which stopped every recording.
    "--start-maximized",
  ],
});
const saved: string[] = [];
try {
  if (!flag("headed"))
    throw new Error(
      "Run it --headed: it records from a maximized window on the real display.",
    );
  const tab = context.pages()[0] ?? (await context.newPage());
  const tabUrl = pathUrl("/home/browser-extension");
  await tab.goto(tabUrl);

  // A page of the extension's origin to speak to its worker, as the popup does.
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${EXTENSION_ID}/permissions.html`);
  // The extension's page took the focus; the recorded tab is the first one.
  await tab.bringToFront();

  type Chrome = {
    tabs: {
      query: (q: object) => Promise<{ id?: number; windowId: number }[]>;
    };
    windows: { update: (id: number, b: object) => Promise<unknown> };
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
  // Every state the worker writes, in order.
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
  /** Wait for the worker to write a `kind` state (a session's states since
   *  `from`), or give up on an idle one; answers it. */
  const until = async (kind: RecorderState["kind"], from: number) => {
    await ext
      .waitForFunction(
        ({ k, from }) =>
          (window as unknown as { states: { kind: string }[] }).states
            .slice(from)
            .some((s) => s.kind === k || s.kind === "idle"),
        { k: kind, from },
        { timeout: TIMEOUT_MS },
      )
      .catch(async (err: unknown) => {
        throw new Error(
          `no ${kind} state; the worker wrote ${JSON.stringify(await states())}`,
          { cause: err },
        );
      });
    const all = (await states()).slice(from);
    const found = all.find((s) => s.kind === kind);
    if (found === undefined)
      throw new Error(
        `the worker never reached ${kind}: ${JSON.stringify(all)}`,
      );
    return found;
  };
  const send = (message: unknown) =>
    ext.evaluate((m) => {
      const c = (globalThis as unknown as { chrome: Chrome }).chrome;
      // Stamped with the loaded build, as the popup stamps its commands.
      return c.runtime.sendMessage({
        ...(m as object),
        equinShellBuild: c.runtime.getManifest().version_name,
      });
    }, message);

  /** Start a recording and wait until it records; answers where its states
   *  begin. */
  const begin = async (name: string) => {
    const from = (await states()).length;
    const reply = await ext.evaluate(async (url) => {
      const c = (globalThis as unknown as { chrome: Chrome }).chrome;
      const [target] = await c.tabs.query({ url });
      if (target?.id === undefined) throw new Error(`no tab at ${url}`);
      return c.runtime.sendMessage({
        equinShellBuild: c.runtime.getManifest().version_name,
        type: "recorder.start",
        tabId: target.id,
        options: {
          preset: "1080p",
          tabAudio: true,
          mic: false,
          pointer: true,
          countdown: true,
        },
      });
    }, tabUrl);
    r.eq(`${name}: the worker took the start`, reply, { ok: true });
    // Resize, countdown (3 s), capture.
    const recording = await until("recording", from);
    r.ok(
      `${name}: it records at the preset's size`,
      recording.kind === "recording" &&
        recording.width === 1920 &&
        recording.height === 1080,
      JSON.stringify(recording),
    );
    return from;
  };

  /** One session: start, record, end it with `end`; answers the idle state. */
  const session = async (name: string, end: () => Promise<void>) => {
    const from = await begin(name);
    await tab.waitForTimeout(RECORD_MS);
    const midway = (await states()).slice(from);
    r.ok(
      `${name}: still recording after a few seconds — nothing stopped it`,
      midway.at(-1)?.kind === "recording",
      JSON.stringify(midway),
    );
    await end();
    const last = await until("idle", from);
    if (last.kind !== "idle" || last.last?.kind !== "saved") {
      r.ok(`${name}: the recording was saved`, false, JSON.stringify(last));
      return null;
    }
    saved.push(last.last.recording.path);
    await checkVideo(name, last.last.recording);
    return last.last;
  };

  const user = await session("stop", async () => {
    await send({ type: "recorder.stop" });
  });
  r.eq("stop: it says you stopped it", user?.stoppedBy, "user");

  const resized = await session("resize", async () => {
    await ext.evaluate(async (url) => {
      const c = (globalThis as unknown as { chrome: Chrome }).chrome;
      const [target] = await c.tabs.query({ url });
      if (target === undefined) throw new Error(`no tab at ${url}`);
      await c.windows.update(target.windowId, { width: 1100, height: 800 });
    }, tabUrl);
  });
  r.eq(
    "resize: it stopped on its own, and says why",
    resized?.stoppedBy,
    "window-resized",
  );

  // Stopped the moment it records, before the recorder's first 1 s chunk can
  // be due: a short video, or the failure saying why nothing was recorded —
  // never a finish of nothing (the 409 the user saw).
  const from = await begin("instant");
  await send({ type: "recorder.stop" });
  const instant = await until("idle", from);
  const outcome = instant.kind === "idle" ? instant.last : null;
  if (outcome?.kind === "saved") saved.push(outcome.recording.path);
  r.ok(
    "instant: saved, or failed saying nothing was recorded and why",
    outcome?.kind === "saved" ||
      (outcome?.kind === "failed" &&
        outcome.error.startsWith("Nothing was recorded") &&
        outcome.error.includes("you stopped it")),
    JSON.stringify(outcome),
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
  for (const path of saved) {
    await rm(path, { force: true });
    await rm(path.replace(/\.mp4$/, ".pointer.json"), { force: true });
  }
}
await r.finish();

async function checkVideo(name: string, saved: SavedRecording): Promise<void> {
  r.eq(
    `${name}: its size is what landed`,
    (await stat(saved.path)).size,
    saved.bytes,
  );
  const ff = await resolveFfmpeg();
  const probe = await spawnExpectOk(
    [
      ff.ffprobe,
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_name,width,height",
      "-of",
      "json",
      saved.path,
    ],
    { timeoutMs: 30_000 },
  );
  const info = JSON.parse(probe.stdout) as {
    format: { duration?: string };
    streams: { codec_name: string; width?: number; height?: number }[];
  };
  const video = info.streams.find((s) => s.codec_name === "h264");
  r.eq(
    `${name}: H.264, 1920 × 1080`,
    `${video?.width}x${video?.height}`,
    "1920x1080",
  );
  r.ok(
    `${name}: it holds the seconds recorded`,
    Number(info.format.duration) > (RECORD_MS / 1000) * 0.75,
    info.format.duration,
  );
}
