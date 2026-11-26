/**
 * The extension end to end: Chromium with this checkout's built shell loaded
 * unpacked, a tab on an equin.ai page (served by the script — the action
 * matches on the tab's URL, and the real site is not this build), then the
 * popup opened as a page of its own.
 *
 *   ./equin run plugins/companions/plugins/browser-extension/e2e/popup-probe.ts [--headed]
 *
 * Asserts the popup frames this checkout's deploy and its bridge answers
 * (hostInfo, then the tab), the Wish section renders, Open locally is offered
 * for the equin.ai tab, and running it moves that tab to the same page on the
 * local instance. Then closes the popup and opens a new one: the new one
 * hands the closed popup's lifecycle trace to the page, which logs it on the
 * `browser-extension` channel, ending in its pagehide.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  flag,
  pathUrl,
  report,
  targetNamespace,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import {
  MAIN_WORKTREE_NAME,
  namespaceUrl,
} from "@plugins/infra/plugins/namespace/core";
import { worktreeDataDir } from "@plugins/infra/plugins/paths/core";
import { ensureDepViaCli } from "@plugins/infra/plugins/deps/deps";
import { launchPersistentChromium } from "@plugins/infra/plugins/deps/plugins/playwright-browser/deps";
import { chromium } from "@plugins/infra/plugins/safe-fetch/plugins/browser-fetch/deps";
import {
  ConnectionStateSchema,
  EXTENSION_ID,
} from "@plugins/companions/plugins/browser-extension/core";
import {
  browserExtensionRoot,
  CONNECTION_FILE,
  SHELL_DIGEST_FILE,
  SHELL_FOLDER,
} from "@plugins/companions/plugins/browser-extension/data-dirs";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";

export const e2e = {
  kind: "test",
  target: "build",
  writes: false,
  run: {
    manual: ["native-helper"],
    why: "Loads this checkout's built browser extension unpacked into Chromium.",
  },
} satisfies E2eScript;

const PUBLIC_PAGE = "https://equin.ai/about/guide";
/**
 * Where Open locally lands: the guide on main's namespace, on the port of the
 * gateway the popup's panel was framed from (this deploy's).
 */
const LOCAL_PAGE = namespaceUrl(
  MAIN_WORKTREE_NAME,
  "/about/guide",
  Number(new URL(pathUrl("/")).port),
);
const TIMEOUT_MS = 60_000;

const r = report("browser extension popup");
const root = browserExtensionRoot(targetNamespace());
const shell = join(root, SHELL_FOLDER);
console.log(`shell: ${shell}`);

const installed = await ensureDepViaCli(chromium, {
  stdio: "inherit",
  grant: null,
});
const profile = await mkdtemp(join(tmpdir(), "equin-extension-probe-"));
// The headed binary: the headless shell runs no extensions. Headless unless
// --headed, in Chrome's own (new) headless mode, which does.
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
  // A stand-in for the published page: only its URL matters to the action.
  await context.route("https://equin.ai/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>The guide · equin</title><h1>The guide</h1>",
    }),
  );
  const tab = context.pages()[0] ?? (await context.newPage());
  await tab.goto(PUBLIC_PAGE);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${EXTENSION_ID}/popup.html`);
  const panel = popup.frameLocator("iframe");

  // The composer's placeholder is drawn text (a rich-text editor), not an
  // input's placeholder attribute.
  const wish = panel.getByText("Fix, change or build anything…", {
    exact: true,
  });
  await wish.waitFor({ timeout: TIMEOUT_MS });
  r.ok("the popup frames the panel and the Wish field renders", true);

  const openLocally = panel.getByText("Open locally", { exact: true });
  await openLocally.waitFor({ timeout: TIMEOUT_MS });
  r.ok(
    "the bridge answered (hostInfo, then the tab): Open locally is offered for equin.ai",
    true,
  );
  r.ok(
    "the panel is not the plain-tab state",
    (await panel
      .getByText("This page runs inside the equin browser extension")
      .count()) === 0,
  );

  // The open was recorded for Settings, on the shell that is served.
  const served = (await readFile(join(root, SHELL_DIGEST_FILE), "utf8")).trim();
  const recorded = ConnectionStateSchema.parse(
    JSON.parse(await readFile(join(root, CONNECTION_FILE), "utf8")),
  );
  r.ok(
    "the popup recorded its open, on the served shell",
    recorded.kind === "seen" &&
      recorded.shellDigest === served &&
      Date.now() - recorded.seenAt < TIMEOUT_MS * 3,
    JSON.stringify(recorded),
  );

  await openLocally.click();
  await tab.waitForURL(LOCAL_PAGE, { timeout: TIMEOUT_MS });
  r.eq("Open locally moved the tab to the local page", tab.url(), LOCAL_PAGE);

  // The popup's lifecycle trace survives its close: the next popup hands it
  // to the page, which logs it.
  const traceLog = join(
    worktreeDataDir(targetNamespace()),
    "logs",
    "browser-extension.jsonl",
  );
  const closedAt = Date.now();
  await popup.close();
  const next = await context.newPage();
  await next.goto(`chrome-extension://${EXTENSION_ID}/popup.html`);
  let line: string | null = null;
  const deadline = Date.now() + TIMEOUT_MS;
  while (line === null && Date.now() < deadline) {
    const text = await readFile(traceLog, "utf8").catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw err;
    });
    line =
      text
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l) as { t: number; line: string })
        .filter(
          (e) => e.t >= closedAt && e.line.startsWith("previous popup opened"),
        )
        .at(-1)?.line ?? null;
    if (line === null) await next.waitForTimeout(500);
  }
  r.ok(
    "the next popup logged the closed one's trace, from its open to its pagehide",
    line !== null &&
      line.includes(" open ") &&
      line.includes(" hello") &&
      line.includes(" pagehide "),
    line ?? "(no trace line)",
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
await r.finish();
