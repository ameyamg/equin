/**
 * The app grid's Keep-in-Dock pin, clicked: with a stand-in
 * `window.equinNative` that keeps apps and can pin, hovering a tile shows its
 * pin, clicking it calls `pinApp(<that app>)`, and a pin the helper reports
 * failed (the Dock did not keep it) rests on the tile as an error mark naming
 * why — never a silent flip.
 *
 *   ./equin run plugins/companions/plugins/menu-bar/e2e/pin-click.ts [--app events]
 */
import {
  arg,
  boot,
  pathUrl,
  report,
  withBrowser,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import { BRIDGE_METHODS } from "@plugins/companions/plugins/menu-bar/core";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";

export const e2e = {
  kind: "test",
  target: "build",
  writes: false,
  run: "auto",
} satisfies E2eScript;

const APP = arg("app") ?? "events";
// The helper's answer when the relaunched Dock did not adopt the tile.
const FAILURE = `the Dock did not take ${APP} in within 15 s`;

const r = report("Menu-bar panel · Keep in Dock pin");

await withBrowser(async (h) => {
  const { page } = await h.session({ viewport: { width: 360, height: 560 } });
  await page.addInitScript(
    ({ methods, failure }) => {
      const calls: string[] = [];
      (window as { __pinCalls?: string[] }).__pinCalls = calls;
      const api: Record<string, (...a: unknown[]) => Promise<unknown>> = {};
      for (const m of methods) api[m] = () => Promise.resolve(undefined);
      api.hostInfo = () =>
        Promise.resolve({
          version: 1,
          platform: "macos",
          capabilities: {
            notify: true,
            attention: true,
            launchApp: true,
            openUrl: true,
            apps: true,
            pin: true,
          },
        });
      api.apps = () => Promise.resolve({ installed: [], pinned: [] });
      api.pinApp = (id) => {
        calls.push(String(id));
        return Promise.reject(new Error(failure));
      };
      (window as { equinNative?: unknown }).equinNative = api;
    },
    { methods: [...BRIDGE_METHODS], failure: FAILURE },
  );
  await boot(page, pathUrl("/home/menu-bar?embed=1"), {
    marker: "text=Fix, change or build anything…",
  });
  const tile = page.getByText(new RegExp(`^${APP}$`, "i")).first();
  await tile.hover();
  const pin = page.getByRole("button", {
    name: new RegExp(`^Keep ${APP} in the Dock$`, "i"),
  });
  await pin.first().waitFor({ state: "attached" });
  r.eq("one pin shows on the hovered tile", await pin.count(), 1);
  await pin.first().click();
  const failed = page.getByRole("button", {
    name: new RegExp(
      `^Keeping ${APP} in the Dock failed: .*did not take .* in within 15 s — click to retry$`,
      "i",
    ),
  });
  await failed.waitFor({ state: "attached", timeout: 5_000 });
  r.eq(
    "the click asked the helper to pin",
    await page.evaluate(() => (window as { __pinCalls?: string[] }).__pinCalls),
    [APP],
  );
  // Away from the tile, the failure still rests on it.
  await page.mouse.move(5, 5);
  r.eq("the failure rests on the tile", await failed.isVisible(), true);
  // Let the page's `pin <id>: asked / failed` lines flush (clientLog debounces
  // 250 ms) to this deploy's logs/menu-bar.jsonl before the page closes.
  await page.waitForTimeout(1_000);
  r.note("page log: logs/menu-bar.jsonl of this deploy (pin … asked / failed)");
});

await r.finish();
