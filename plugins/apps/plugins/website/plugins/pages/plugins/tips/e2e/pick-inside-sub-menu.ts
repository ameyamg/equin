// The tip "Picking items inside a sub-menu", two menus deep: while
// picking an element, ⌘-click (Ctrl-click) clicks for real — it opens the
// prompt's Preprompt menu, then the editor of one preprompt inside it — and a
// plain click then picks the editor's Delete · Cancel · Save row into a Wish.
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
      .getByRole("button", { name: "Preprompt" })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  },
  async script(r) {
    const page = r.page;
    const bar = page.locator('[data-source*="floating-action"]').first();
    const pick = page.getByRole("button", { name: "Pick UI element" });
    // The prompt: its text field and the Preprompt menu's trigger.
    const field = page.getByRole("textbox").first();
    const trigger = page.getByRole("button", { name: "Preprompt" }).first();
    const menu = page.getByRole("menu");
    const row = menu
      .getByRole("menuitem")
      .filter({ hasText: /^Auto-push and exit$/ });
    const edit = menu.getByRole("button", { name: "Edit: Auto-push and exit" });
    // The editor's footer row (Delete, then Cancel · Save): the item picked.
    const footer = menu
      .getByRole("button", { name: "Delete", exact: true })
      .locator("xpath=..");
    // The Wish the footer is picked into (the editor stays open under it).
    const wish = page
      .locator('[data-slot="popover-content"]')
      .filter({ hasText: "Make a wish" });

    // Arm the picker from the action bar (it unfolds under the hand).
    await r.move(bar);
    await r.hold(0.35);
    await r.click(pick);
    await r.hold(0.3);

    // In on the prompt while the hand reaches for its Preprompt menu.
    await r.focus([field, trigger], { margin: 40, maxZoom: 1.8 });
    await r.move(trigger);
    await r.hold(0.6);
    // ⌘-click: a real click, the menu opens instead of being picked. The
    // camera widens to hold the prompt and the menu under it — at 1.5× so
    // the taller editor the menu turns into below still fits, with no move.
    await r.click(trigger, { modifiers: ["ControlOrMeta"] });
    await r.focus([field, menu], { margin: 32, maxZoom: 1.5 });
    await r.hold(0.4);
    // Into the menu: a preprompt's edit pencil, ⌘-clicked too.
    await r.move(row);
    await r.hold(0.4);
    await r.move(edit);
    await r.hold(0.4);
    await r.click(edit, { modifiers: ["ControlOrMeta"] });
    // The editor opens in place, inside the same framing.
    await r.hold(0.9);
    // A plain click picks what's inside: the editor's footer row, aimed at
    // the gap between Delete and Cancel · Save (0.45 across) so the row is
    // picked rather than one of its buttons.
    await r.move({ element: footer, at: { x: 0.45, y: 0.5 } });
    await r.hold(0.8);
    await r.click({ element: footer, at: { x: 0.45, y: 0.5 } });
    // The Wish opens at the top right: the camera widens to hold it and the
    // editor the row was picked from, the click and its result in one frame.
    await r.focus([wish, menu], { margin: 32, maxZoom: 1.8 });
    await r.hold(2.6);
  },
});
