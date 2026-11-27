// The tip "Picking items inside a sub-menu": while picking an element,
// ⌘-click (Ctrl-click) clicks for real — it opens the model menu of Agent
// Manager's prompt — and a plain click then picks a row inside it into a Wish.
//
//   ./equin run plugins/apps/plugins/website/plugins/pages/plugins/tips/e2e/pick-inside-sub-menu.ts --composition promo-film
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

await tipVideo({
  slug: "pick-inside-sub-menu",
  path: "/agents",
  cursor: { x: 820, y: 560 },
  async prepare(page) {
    await page
      .locator('[aria-haspopup="menu"]')
      .filter({ hasText: "Opus" })
      .waitFor({ state: "visible", timeout: 30_000 });
  },
  async script(r) {
    const page = r.page;
    const bar = page.locator('[data-source*="floating-action"]').first();
    const pick = page.getByRole("button", { name: "Pick UI element" });
    const trigger = page
      .locator('[aria-haspopup="menu"]')
      .filter({ hasText: "Opus" });
    // The prompt: its text field and the model menu's trigger.
    const field = page.getByRole("textbox").first();
    const menu = page.getByRole("menu");
    const row = menu
      .getByRole("menuitem")
      .filter({ hasText: /^Sonnet/ })
      .first();
    // The Wish the row is picked into (the menu stays open under it).
    const wish = page
      .locator('[data-slot="popover-content"]')
      .filter({ hasText: "Make a wish" });

    // Arm the picker from the action bar (it unfolds under the hand).
    await r.move(bar);
    await r.hold(0.35);
    await r.click(pick);
    await r.hold(0.3);

    // In on the prompt while the hand reaches for its model menu.
    await r.focus([field, trigger], { margin: 40, maxZoom: 1.8 });
    await r.move(trigger);
    await r.hold(0.6);
    // ⌘-click: a real click, the menu opens instead of being picked.
    await r.click(trigger, { modifiers: ["ControlOrMeta"] });
    await r.focus([trigger, menu], { margin: 28, maxZoom: 2 });
    await r.hold(0.5);
    // A plain click picks a row inside it.
    await r.move(row);
    await r.hold(0.7);
    await r.click(row);
    await r.hold(0.6);

    // The camera moves on to the Wish it was picked into.
    await r.focus(wish, { margin: 36, maxZoom: 1.7 });
    await r.hold(2.2);
  },
});
