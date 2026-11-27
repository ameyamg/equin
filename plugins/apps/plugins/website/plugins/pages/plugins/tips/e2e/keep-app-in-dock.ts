// The tip "Native Mac applications": in the panel the equin menu-bar icon
// opens, hovering an app's tile offers a pin — Keep <App> in the Dock — and a
// click keeps it there, so it launches as an app of its own.
//
//   ./equin run plugins/apps/plugins/website/plugins/pages/plugins/tips/e2e/keep-app-in-dock.ts --composition promo-film
//
// What it films, and what it cannot: the panel is the real page the helper
// opens (/home/menu-bar?embed=1), drawn as the helper's window — 360 px wide,
// its height the one the page asks for (setPanelHeight), at the top right of
// a plain backdrop. A browser has no window.equinNative, so a stand-in bridge
// answers for the main instance's tray on macOS (it can pin; pinApp resolves
// after a beat and the app is then pinned). Two departures from the real
// helper: no window material (a browser cannot draw the vibrancy, so the page
// paints its own fill and the CSS rounds the window), and no installed shims
// (a tile clicked here would open in the browser, not its window — this take
// clicks none). The macOS
// Dock and menu bar are not the page's: they are not drawn, nor faked — the
// take ends on the tile once its pin is done.
//
// See this plugin's CLAUDE.md (Tip videos) for the flags and the steps.

import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";
import { tipVideo } from "./internal/tip-video";

export const e2e = {
  kind: "tool",
  target: { composition: "promo-film" },
  writes: false,
  run: {
    manual: ["heavy"],
    why: "Records and renders one tip's video (minutes of frame-by-frame capture).",
  },
} satisfies E2eScript;

/** The helper's panel window: its width, and where it hangs under the menu bar. */
const PANEL = { width: 360, top: 10, right: 150, radius: 12 };

await tipVideo({
  slug: "keep-app-in-dock",
  path: "/home/menu-bar?embed=1",
  cursor: { x: 760, y: 420 },
  async init(context) {
    // The helper's bridge (menu-bar/rust/src/bridge.js): on the panel's
    // page, in its main frame only, as the real one.
    await context.addInitScript(() => {
      if (window.top !== window) return;
      if (!location.pathname.startsWith("/home/menu-bar")) return;
      const pinned: string[] = [];
      const none = () => Promise.resolve(undefined);
      (window as { equinNative?: unknown }).equinNative = {
        hostInfo: () =>
          Promise.resolve({
            version: 1,
            platform: "macos",
            capabilities: {
              // No notifications row: the take is about the apps.
              notify: false,
              attention: true,
              launchApp: true,
              openUrl: true,
              apps: true,
              pin: true,
            },
            // No material: the page paints its own fill (see the header).
            material: null,
          }),
        setAttention: none,
        notify: none,
        openUrl: none,
        launchApp: none,
        hidePanel: none,
        // The window takes the height the page asks for, clamped as the
        // helper's (rust/src/panel.rs MIN_HEIGHT / MAX_HEIGHT; the CSS's
        // 560px fallback is its INITIAL_HEIGHT).
        setPanelHeight: (px: number) => {
          document.documentElement.style.setProperty(
            "--tip-panel-height",
            `${Math.min(720, Math.max(200, px))}px`,
          );
          return Promise.resolve();
        },
        apps: () => Promise.resolve({ installed: [], pinned: [...pinned] }),
        // `defaults write com.apple.dock` + `killall Dock` take a moment.
        pinApp: (id: string) =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              pinned.push(id);
              resolve();
            }, 900),
          ),
      };
    });
  },
  async prepare(page) {
    await page
      .getByRole("button", { name: "Keep Pages in the Dock", exact: true })
      .waitFor({ state: "attached", timeout: 30_000 });
    await page
      .getByRole("button", { name: / Pages$/ })
      .waitFor({ state: "visible", timeout: 30_000 });
    // The page as the helper's window: the panel at the top right, the
    // rest of the screen a plain backdrop (no desktop or Dock is drawn).
    await page.addStyleTag({
      content: `
        html { background: radial-gradient(120% 90% at 70% 0%, #1d2740 0%, #0b0f18 60%, #07090e 100%) !important; }
        body { background: transparent !important; }
        #root {
          position: fixed !important;
          top: ${PANEL.top}px; right: ${PANEL.right}px; left: auto; bottom: auto;
          width: ${PANEL.width}px; height: var(--tip-panel-height, 560px);
          border-radius: ${PANEL.radius}px; overflow: hidden;
          transform: translateZ(0);
          box-shadow: 0 24px 70px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08);
        }`,
    });
  },
  async script(r) {
    const page = r.page;
    // A tile is a button whose name ends with its app's (its pin's label
    // comes first while it offers one).
    const tile = (name: string) =>
      page.getByRole("button", { name: new RegExp(`(^| )${name}$`) });
    const pin = (name: string) =>
      page.getByRole("button", {
        name: `Keep ${name} in the Dock`,
        exact: true,
      });
    const apps = page.getByText("Apps", { exact: true }).first();

    // In on the panel's apps while the hand comes up to them.
    await r.focus([apps, tile("Places"), tile("Deploy")], {
      margin: 24,
      maxZoom: 1.9,
    });
    await r.move(tile("Pages"), { duration: 0.9 });
    // Hovering a tile offers its pin on the icon's corner.
    await r.hold(0.8);
    await r.move(pin("Pages"), { duration: 0.5 });
    // Its tooltip names what it does.
    await r.hold(1.3);
    await r.click(pin("Pages"));
    // The helper pins it (a spinner while the Dock restarts), then the pin
    // is gone: Pages is in the Dock.
    await r.hold(1.6);
    // Another tile still offers its pin; Pages no longer does.
    await r.move(tile("Places"), { duration: 0.8 });
    await r.hold(0.9);
    await r.move(tile("Pages"), { duration: 0.7 });
    await r.hold(1.4);
  },
});
