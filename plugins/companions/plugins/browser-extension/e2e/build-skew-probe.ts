/**
 * The shell's parts from two builds at once, as Chrome really runs them after
 * a build: Chrome keeps the manifest and the service worker it loaded until
 * the extension reloads, but reads the popup, the offscreen document and the
 * content script from disk each time they open.
 *
 *   ./equin run plugins/companions/plugins/browser-extension/e2e/build-skew-probe.ts [--headed]
 *
 * Loads a copy of this checkout's built shell, then writes a "next build"
 * over it on disk (every part's build stamp changed, as a real build changes
 * it) without reloading the extension, and asserts:
 *
 * - the popup — the next build, under the loaded manifest — knows it is a
 *   stale load and has the page ask Chrome to reload the extension;
 * - a recording started then — the loaded worker, the next build's offscreen
 *   recorder — fails with the words that say to reload, never a parse error.
 *
 * Why this exists: 2026-11-25, a build that changed only the worker and the
 * offscreen recorder kept the manifest's version, so nothing reloaded the
 * extension; the old worker sent the new recorder a stop without the
 * `stoppedBy` it now required, and the panel showed zod's raw issue list.
 * Every other probe loads one build whole.
 */
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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
import {
  EXTENSION_ID,
  type RecorderState,
} from "@plugins/companions/plugins/browser-extension/core";
import {
  browserExtensionRoot,
  SHELL_FOLDER,
} from "@plugins/companions/plugins/browser-extension/data-dirs";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";

export const e2e = {
  kind: "test",
  target: "build",
  writes: false,
  run: {
    manual: ["native-helper"],
    why: "Loads a copy of this checkout's built browser extension into Chromium and rewrites it on disk as a next build, without reloading it.",
  },
} satisfies E2eScript;

const TIMEOUT_MS = 60_000;
const NEXT_BUILD = "build-skew-probe-next-build";

const r = report("browser extension parts from two builds");
const built = join(browserExtensionRoot(targetNamespace()), SHELL_FOLDER);
const scratch = await mkdtemp(join(tmpdir(), "equin-skew-shell-"));
const shell = join(scratch, "shell");
await cp(built, shell, { recursive: true });
const loaded = (
  JSON.parse(await readFile(join(shell, "manifest.json"), "utf8")) as {
    version_name: string;
  }
).version_name;

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
    `--allowlisted-extension-id=${EXTENSION_ID}`,
  ],
});
try {
  const tab = context.pages()[0] ?? (await context.newPage());
  const tabUrl = pathUrl("/home/browser-extension");
  await tab.goto(tabUrl);
  // A page of the LOADED build, to speak to its worker.
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${EXTENSION_ID}/permissions.html`);
  await ext.evaluate(() => {
    const w = window as unknown as { states: unknown[] };
    w.states = [];
    (
      globalThis as unknown as {
        chrome: {
          storage: {
            onChanged: {
              addListener: (
                f: (c: Record<string, { newValue?: unknown }>) => void,
              ) => void;
            };
          };
        };
      }
    ).chrome.storage.onChanged.addListener((changes) => {
      const next = changes["recorder.state"]?.newValue;
      if (next !== undefined) w.states.push(next);
    });
  });

  // The next build lands on disk; Chrome is not told.
  for (const name of await readdir(shell)) {
    if (!/\.(js|json|html)$/.test(name)) continue;
    const text = await readFile(join(shell, name), "utf8");
    await writeFile(join(shell, name), text.replaceAll(loaded, NEXT_BUILD));
  }
  r.ok(
    "the next build's manifest names it",
    (await readFile(join(shell, "manifest.json"), "utf8")).includes(NEXT_BUILD),
  );

  // The popup, read from disk: the next build under the loaded manifest.
  await context.addInitScript(() => {
    const runtime = (
      globalThis as unknown as {
        chrome?: { runtime?: { reload?: () => void } };
      }
    ).chrome?.runtime;
    if (runtime?.reload === undefined) return;
    runtime.reload = () => {
      document.documentElement.dataset.reloadRequested = "yes";
    };
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${EXTENSION_ID}/popup.html`);
  await popup.waitForFunction(
    () => document.documentElement.dataset.reloadRequested === "yes",
    undefined,
    { timeout: TIMEOUT_MS },
  );
  r.ok("the popup knew it was a stale load and asked for a reload", true);
  await popup.close();

  // A recording: the loaded worker, the next build's offscreen recorder.
  await tab.bringToFront();
  const reply = await ext.evaluate(
    async ({ url, build }) => {
      const c = (
        globalThis as unknown as {
          chrome: {
            tabs: { query: (q: object) => Promise<{ id?: number }[]> };
            runtime: { sendMessage: (m: unknown) => Promise<unknown> };
          };
        }
      ).chrome;
      const [target] = await c.tabs.query({ url });
      if (target?.id === undefined) throw new Error(`no tab at ${url}`);
      return c.runtime.sendMessage({
        type: "recorder.start",
        tabId: target.id,
        options: {
          preset: "as-is",
          tabAudio: false,
          mic: false,
          clicks: false,
          countdown: false,
        },
        // As the loaded build's popup stamps it.
        equinShellBuild: build,
      });
    },
    { url: tabUrl, build: loaded },
  );
  r.eq("the loaded worker took the start", reply, { ok: true });
  await ext.waitForFunction(
    () =>
      (window as unknown as { states: { kind: string }[] }).states.at(-1)
        ?.kind === "idle",
    undefined,
    { timeout: TIMEOUT_MS },
  );
  const last = await ext.evaluate(() =>
    (window as unknown as { states: RecorderState[] }).states.at(-1),
  );
  const error =
    last?.kind === "idle" && last.last?.kind === "failed"
      ? last.last.error
      : null;
  r.ok(
    "it failed saying the extension must be reloaded — words, not a parse error",
    error !== null &&
      error.startsWith("The extension was updated while it ran") &&
      !error.includes("[{"),
    JSON.stringify(last),
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
}
await r.finish();
