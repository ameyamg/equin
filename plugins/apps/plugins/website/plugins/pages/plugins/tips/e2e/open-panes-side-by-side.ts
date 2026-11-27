// The tip "Open panes side by side": in Agent Manager's Tasks, one task is
// already open beside the list; ⌥-click (Alt-click) on another task opens it
// in a new pane next to the list (the pane clicked from), and the first one
// stays open beside it.
//
//   ./equin run plugins/apps/plugins/website/plugins/pages/plugins/tips/e2e/open-panes-side-by-side.ts --composition promo-film
//
// See this plugin's CLAUDE.md (Tip videos) for the flags and the steps.

import type { Page } from "playwright";
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

// The seed's two wishes: the one open at the start, and the one ⌥-clicked.
const OPEN = "Weekly grocery list from my recipes";
const ADDED = "Import my Goodreads shelf into Reading";
const OPEN_ID = "task-1792800000-film02";

/** The open pane whose header reads this title. */
function paneTitled(page: Page, title: string) {
  return page.locator("[data-pane-id]").filter({
    has: page.getByRole("button", { name: `${title} Expand pane Close` }),
  });
}

await tipVideo({
  slug: "open-panes-side-by-side",
  // The Tasks list with the first wish already open beside it.
  path: `/agents/tasks/t/${OPEN_ID}`,
  cursor: { x: 900, y: 420 },
  async prepare(page) {
    await paneTitled(page, OPEN).waitFor({ state: "visible", timeout: 30_000 });
  },
  async script(r) {
    const page = r.page;
    // The Tasks list's title cells (the sidebar's rows are buttons, not cells).
    const row = page.getByRole("gridcell", { name: ADDED, exact: true });
    const openRow = page.getByRole("gridcell", { name: OPEN, exact: true });
    const added = paneTitled(page, ADDED);
    const addedTop = added.locator('[data-part="pane.header"]');
    // The task's title field at the top of its Task card.
    const addedTask = added.getByRole("textbox", { name: "Untitled" });

    // In on the list while the hand reaches for the second wish.
    await r.focus([openRow, row], { margin: 48, maxZoom: 1.8 });
    await r.move(row);
    await r.hold(0.7);
    // ⌥-click: the wish opens beside the list, the open one is kept.
    await r.click(row, { modifiers: ["Alt"] });
    await r.hold(0.25);
    // The camera follows the new pane as it opens, while its title is read.
    await r.focus([addedTop, addedTask], { margin: 40, maxZoom: 1.7 });
    await r.hold(1.6);
    // Pull back: both wishes, side by side.
    await r.unfocus();
    // The hand rests in the new pane's header, between its title and buttons,
    // off the text while both panes are seen whole.
    await r.move({ element: addedTop, at: { x: 0.62, y: 0.5 } });
    await r.hold(1.8);
  },
});
