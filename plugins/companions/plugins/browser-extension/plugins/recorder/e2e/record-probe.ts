/**
 * The recorder end to end, as far as a script can drive it: Chromium with
 * this checkout's built shell loaded unpacked, a tab on this deploy, the popup
 * opened as a page of its own.
 *
 *   ./equin run plugins/companions/plugins/browser-extension/plugins/recorder/e2e/record-probe.ts [--headed]
 *
 * Asserts the Record section renders with its size dropdown (the tab measured
 * through the shell), then uploads a real fragmented MP4 (made by ffmpeg) the
 * way the offscreen recorder does — through the relay page, framed from the
 * extension's origin, chunk by chunk — and checks the file lands in the
 * Recordings folder remuxed (faststart, its duration known), with its pointer
 * track beside it; then removes both.
 *
 * Not covered: `tabCapture` itself, which Chrome grants only on a real click
 * on the extension (the user's manual check).
 */
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
  RECORDER_RELAY_PATH,
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
    manual: ["native-helper"],
    why: "Loads this checkout's built browser extension unpacked into Chromium and writes a test recording into the Recordings folder (removed after).",
  },
} satisfies E2eScript;

const TIMEOUT_MS = 60_000;
/** Where the popup's screenshots go (printed at the end, kept). */
const shots = await mkdtemp(join(tmpdir(), "equin-record-shots-"));
const shot = (name: string) => join(shots, name);
const CHUNK = 64 * 1024;

const r = report("browser extension recorder");
const shell = join(browserExtensionRoot(targetNamespace()), SHELL_FOLDER);

// A 2 s fragmented MP4, as MediaRecorder writes one (moov first, no duration).
const ff = await resolveFfmpeg();
const scratch = await mkdtemp(join(tmpdir(), "equin-record-probe-"));
const sample = join(scratch, "sample.mp4");
await spawnExpectOk(
  [
    ff.ffmpeg,
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=1280x720:rate=30:duration=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    sample,
  ],
  { timeoutMs: 60_000 },
);
const bytes = await readFile(sample);
const chunks: number[][] = [];
for (let i = 0; i < bytes.byteLength; i += CHUNK)
  chunks.push([...bytes.subarray(i, i + CHUNK)]);

const installed = await ensureDepViaCli(chromium, {
  stdio: "inherit",
  grant: null,
});
const profile = await mkdtemp(join(tmpdir(), "equin-extension-probe-"));
const context = await launchPersistentChromium(installed, profile, {
  signals: "playwright",
  headless: false,
  args: [
    ...(flag("headed") ? [] : ["--headless=new"]),
    `--disable-extensions-except=${shell}`,
    `--load-extension=${shell}`,
  ],
});
let saved: {
  path: string;
  folder: string;
  name: string;
  bytes: number;
} | null = null;
try {
  // A tab on this deploy: under the extension's host permission, so the
  // shell can measure it for the size presets.
  const tab = context.pages()[0] ?? (await context.newPage());
  await tab.goto(pathUrl("/home/browser-extension"));

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 440, height: 600 });
  await popup.goto(`chrome-extension://${EXTENSION_ID}/popup.html`);
  const panel = popup.frameLocator("iframe");

  await panel
    .getByText("Record this tab", { exact: true })
    .waitFor({ timeout: TIMEOUT_MS });
  r.ok("the Record section renders", true);
  const size = panel.locator(".rec-dd");
  await size.waitFor({ timeout: TIMEOUT_MS });
  r.ok("the tab was measured: the size dropdown is offered", true);
  r.eq(
    "the default size is 1080p",
    (await size.innerText()).includes("1080p"),
    true,
  );
  r.eq("four toggles", await panel.locator(".rec-tg").count(), 4);
  // Headless Chromium draws at DPR 1: 1080p would be an upscale, so Record
  // says why it is off rather than failing on click.
  const go = panel.locator(".rec-go");
  const dpr = await tab.evaluate(() => window.devicePixelRatio);
  r.eq(
    "Record is off exactly when the size cannot be recorded",
    await go.isDisabled(),
    dpr < 1.5,
  );
  if (dpr < 1.5)
    r.ok(
      "and says why",
      ((await go.getAttribute("title")) ?? "").includes(
        "Needs a Retina display",
      ),
    );
  await popup.screenshot({ path: shot("record-section.png") });
  await size.click();
  // 720p's entry names its video size whatever the display.
  await panel.getByText("1280 × 720").waitFor({ timeout: TIMEOUT_MS });
  r.ok("the dropdown lists the presets with their video size", true);
  await popup.screenshot({ path: shot("record-size-menu.png") });
  await popup.keyboard.press("Escape");

  // The relay path, driven from the extension's origin as the offscreen
  // document drives it.
  const origin = await popup.evaluate(
    () =>
      document
        .querySelector('meta[name="equin-origin"]')
        ?.getAttribute("content") ?? "",
  );
  saved = await popup.evaluate(
    async ({ origin, path, chunks }) => {
      const frame = document.createElement("iframe");
      frame.style.display = "none";
      frame.src = `${origin}${path}?embed=1`;
      document.body.append(frame);
      const port = await new Promise<MessagePort>((resolve) => {
        window.addEventListener("message", (event) => {
          if (event.source !== frame.contentWindow || event.origin !== origin)
            return;
          const channel = new MessageChannel();
          frame.contentWindow?.postMessage(
            { type: "equin-bridge-port", version: 1 },
            origin,
            [channel.port2],
          );
          resolve(channel.port1);
        });
      });
      let id = 0;
      const call = (
        req: Record<string, unknown>,
        transfer: Transferable[] = [],
      ) =>
        new Promise<unknown>((resolve, reject) => {
          const mine = id++;
          const onMessage = (
            m: MessageEvent<{
              id: number;
              ok: boolean;
              value?: unknown;
              error?: string;
            }>,
          ) => {
            if (m.data.id !== mine) return;
            port.removeEventListener("message", onMessage);
            if (m.data.ok) resolve(m.data.value);
            else reject(new Error(m.data.error));
          };
          port.addEventListener("message", onMessage);
          port.start();
          port.postMessage({ id: mine, ...req }, transfer);
        });
      const created = (await call({ op: "create", title: "Record probe" })) as {
        recordingId: string;
      };
      if (typeof created?.recordingId !== "string")
        throw new Error(`create answered ${JSON.stringify(created)}`);
      for (const [seq, chunk] of chunks.entries()) {
        const buffer = new Uint8Array(chunk).buffer;
        await call(
          { op: "chunk", recordingId: created.recordingId, seq, bytes: buffer },
          [buffer],
        );
      }
      return (await call({
        op: "finish",
        recordingId: created.recordingId,
        durationMs: 2000,
        pointer: {
          version: 1,
          viewport: { width: 1280, height: 720 },
          samples: [
            [0, 10, 10, "move"],
            [500, 20, 20, "down"],
          ],
        },
      })) as { path: string; folder: string; name: string; bytes: number };
    },
    { origin, path: RECORDER_RELAY_PATH, chunks },
  );
  r.ok(
    "the relay uploaded the recording",
    saved.path.endsWith(".mp4"),
    saved.path,
  );
  r.ok(
    "named <date> <title>.mp4",
    / Record probe(?: \(\d+\))?\.mp4$/.test(saved.name),
    saved.name,
  );
  r.eq("its size is what landed", (await stat(saved.path)).size, saved.bytes);

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
  r.eq("H.264", info.streams[0]?.codec_name, "h264");
  r.eq(
    "1280 × 720",
    `${info.streams[0]?.width}x${info.streams[0]?.height}`,
    "1280x720",
  );
  r.ok(
    "its duration is known (remuxed)",
    Number(info.format.duration) > 1.5,
    info.format.duration,
  );
  const head = (await readFile(saved.path)).subarray(0, 64).toString("latin1");
  r.ok(
    "faststart: moov before mdat",
    head.includes("ftyp") && !head.includes("mdat"),
    head,
  );
  const pointer = saved.path.replace(/\.mp4$/, ".pointer.json");
  r.ok(
    "the pointer track is beside it",
    (await stat(pointer)).size > 0,
    pointer,
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
  if (saved !== null) {
    await rm(saved.path, { force: true });
    await rm(saved.path.replace(/\.mp4$/, ".pointer.json"), { force: true });
  }
}
console.log(`screenshots: ${shots}`);
await r.finish();
