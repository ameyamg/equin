/**
 * The shell's self-update, as Chrome really runs it: an unpacked extension
 * reads its popup's files from disk on every open, but its manifest — and so
 * its permissions — only when the extension is (re)loaded. After a build
 * writes a shell that asks for more permissions, the popup runs the NEW
 * scripts under the OLD manifest until the extension reloads; and only the
 * bridge can ask it to reload. So the bridge must come up whatever the
 * loaded manifest lacks.
 *
 *   ./equin run plugins/companions/plugins/browser-extension/e2e/stale-manifest-probe.ts [--headed]
 *
 * Loads a copy of this checkout's built shell whose manifest is the one
 * before the recorder (no storage, tabCapture, offscreen, scripting, service
 * worker or command), and asserts the panel still renders, without the Record
 * section the old manifest cannot run, and that the popup asks Chrome to
 * reload it onto the manifest on disk.
 *
 * Why this exists: 2026-11-25, the recorder's popup touched chrome.storage at
 * load, before its bridge listener; in the user's Chrome (the old manifest
 * still loaded) it threw, and the popover stayed blank. Fresh-profile probes
 * load the new manifest and could not see it.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { EXTENSION_ID } from "@plugins/companions/plugins/browser-extension/core";
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
    why: "Loads a copy of this checkout's built browser extension, under an older manifest, into Chromium.",
  },
} satisfies E2eScript;

const TIMEOUT_MS = 60_000;

const r = report("browser extension under a stale manifest");
const built = join(browserExtensionRoot(targetNamespace()), SHELL_FOLDER);
const scratch = await mkdtemp(join(tmpdir(), "equin-stale-shell-"));
const shell = join(scratch, "shell");
await cp(built, shell, { recursive: true });
const manifest = JSON.parse(
  await readFile(join(shell, "manifest.json"), "utf8"),
) as Record<string, unknown>;
// The manifest before the recorder: what a Chrome that has not reloaded the
// extension since still holds. Its version_name is not the one on disk.
const { background: _background, commands: _commands, ...older } = manifest;
await writeFile(
  join(shell, "manifest.json"),
  JSON.stringify({
    ...older,
    version_name: "an older shell",
    permissions: ["activeTab", "tabs"],
  }),
);

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
try {
  const tab = context.pages()[0] ?? (await context.newPage());
  await tab.goto(pathUrl("/home/browser-extension"));
  // A real Chrome reloads the extension here (and so closes the popup); a
  // --load-extension one is blocked after a runtime.reload(), so the probe
  // records the request instead and keeps the popup to look at.
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
  const errors: string[] = [];
  const popup = await context.newPage();
  popup.on("pageerror", (err) => errors.push(err.message));
  await popup.goto(`chrome-extension://${EXTENSION_ID}/popup.html`);
  const panel = popup.frameLocator("iframe");

  await panel
    .getByText("Fix, change or build anything…", { exact: true })
    .waitFor({ timeout: TIMEOUT_MS });
  r.ok("the bridge came up: the panel renders its Wish field", true);
  r.eq("the popup script threw nothing", errors.join(" | "), "");
  r.eq(
    "no Record section: the loaded manifest cannot record",
    await panel.getByText("Record this tab", { exact: true }).count(),
    0,
  );
  await popup.waitForFunction(
    () => document.documentElement.dataset.reloadRequested === "yes",
    undefined,
    { timeout: TIMEOUT_MS },
  );
  r.ok("the page asked Chrome to reload onto the manifest on disk", true);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
}
await r.finish();
