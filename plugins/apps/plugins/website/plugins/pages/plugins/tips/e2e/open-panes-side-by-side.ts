// The tip "Open panes side by side", in Agent Manager on the promo-film demo:
// with the Grieg conversation open, ⌥-click (Alt-click) two more conversations
// in the sidebar — each opens in a pane of its own beside the others — then
// ⌥-click the middle one's Close, which closes only that pane. Inside the
// first conversation, ⌥-click its Pages button and the score it saved: each
// opens right after it, before the conversation still open on the right (the
// sidebar folded first, so three panes fit). The row ends scrolled back to its
// start.
//
// The camera never zooms: every click changes another part of the screen (a
// pane opening beside), so the click and its result stay in one frame. The
// hand goes straight to each target and clicks as it arrives; it pauses only
// once a result is on screen.
//
//   ./equin run plugins/apps/plugins/website/plugins/pages/plugins/tips/e2e/open-panes-side-by-side.ts --composition promo-film
//
// See this plugin's CLAUDE.md (Tip videos) for the flags and the steps.

import type { Locator, Page } from "playwright";
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

// The seed's three waiting conversations: the one open at the start, and the
// two ⌥-clicked open from the sidebar (the second of which stays).
const GRIEG = "Score and MIDI for Wedding-day at Troldhaugen";
const GROCERY = "Weekly grocery list from my recipes";
const GOODREADS = "Import my Goodreads shelf into Reading";
const GRIEG_ID = "conv-1792800000-film01";
/**
 * The score's first page the Grieg conversation saved, a file chip in its last
 * message: an image, drawn in its pane (the score's PDF stays blank in a
 * headless browser, which has no PDF viewer).
 */
const SCORE_PAGE = "scores/wedding-day-at-troldhaugen-page-1.png";

/** The open pane whose header reads this title. */
function paneTitled(page: Page, title: string): Locator {
  return page.locator("[data-pane-id]").filter({
    has: page.locator('[data-part="pane.header"]', { hasText: title }),
  });
}

await tipVideo({
  slug: "open-panes-side-by-side",
  path: `/agents/c/${GRIEG_ID}`,
  cursor: { x: 760, y: 560 },
  async prepare(page) {
    await paneTitled(page, GRIEG).waitFor({
      state: "visible",
      timeout: 30_000,
    });
  },
  async script(r) {
    const page = r.page;
    const sidebar = page.locator('[data-sidebar="sidebar"]');
    const grieg = paneTitled(page, GRIEG);
    const grocery = paneTitled(page, GROCERY);

    // Two more conversations from the sidebar, each beside the others.
    const groceryRow = sidebar.getByRole("button", { name: GROCERY });
    await r.click(groceryRow, { modifiers: ["Alt"] });
    await r.hold(0.8);
    const goodreadsRow = sidebar.getByRole("button", { name: GOODREADS });
    await r.click(goodreadsRow, { modifiers: ["Alt"] });
    await r.hold(0.9);

    // ⌥ on the middle one's Close: only that pane goes, the one after stays.
    const close = grocery.getByRole("button", { name: "Close", exact: true });
    await r.click(close, { modifiers: ["Alt"] });
    await r.hold(0.8);

    // Room for three panes (3 × Miller's 420 px share): the sidebar folds away.
    const toggle = grieg.getByRole("button", {
      name: "Toggle Sidebar",
      exact: true,
    });
    await r.click(toggle);
    await r.hold(0.6);

    // Inside the first conversation, its pages open right after it…
    const pages = grieg.getByRole("button", { name: "Pages", exact: true });
    await r.click(pages, { modifiers: ["Alt"] });
    await r.hold(1.0);
    // …and so does the score page it saved, before the pages: the row slides
    // to its end (Miller always does), the conversation off to the left.
    const score = grieg.getByRole("button", { name: SCORE_PAGE, exact: true });
    await r.click(score, { modifiers: ["Alt"] });
    await r.hold(1.3);

    // Back to the start of the row: the conversation, then the two panes it
    // opened, with the conversation kept from the start further right.
    await r.scrollTo(grieg, 0, { axis: "x", duration: 1.2 });
    await r.hold(1.6);
  },
});
