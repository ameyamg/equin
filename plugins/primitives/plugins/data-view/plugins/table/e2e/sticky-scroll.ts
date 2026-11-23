/**
 * Verifies the grid table's column model: stable, resizable columns that never
 * drop, a sideways scroll wherever the table sits, nothing sticky by default,
 * and frozen columns from the header menu.
 *
 * Surfaces (each a route naming the table view, overridable):
 * - `page` (`--page-path`) — a flat table in the pane's `Scroll` (Tasks,
 *   "Sidequests flat");
 * - `card` (`--card-path`) — a table inside a card (a deployment's
 *   Deployments card, "All").
 *
 * Per surface, at 1440 then 390 wide:
 * - nothing is sticky sideways by default (the first header cell is static);
 * - the 390 table shows exactly the columns the 1440 one does (none dropped);
 * - at 390 it is wider than its box and scrolls sideways — the pane's `Scroll`
 *   for `page` (`data-scrolls-x`), the table's own box for `card` (the pane
 *   never scrolls sideways for a card table), its header pinned flush in it;
 * - Freeze up to here (second column's menu) pins the first two columns while
 *   scrolled, a later column moving under them; Unfreeze puts them back.
 * At 1440 on `page` (light only): dragging the second column's header edge
 * +60px widens it by 60, the width survives a reload, and dragging back
 * restores it.
 *
 * Manual only. Run after `./equin build`:
 *   ./equin run plugins/primitives/plugins/data-view/plugins/table/e2e/sticky-scroll.ts \
 *     [--page-path <route>] [--card-path <route>] [--out "$EQUIN_SCRATCH/sticky-scroll"] [--headed]
 */
import type { Locator, Page } from "playwright";
import {
  arg,
  boot,
  pathUrl,
  report,
  snap,
  withBrowser,
  type Report,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";

export const e2e = {
  kind: "test",
  target: "build",
  writes: true,
  run: {
    manual: ["stateful"],
    why: "Default routes name a hardcoded view id and deployment id that must exist in the deploy.",
  },
} satisfies E2eScript;

const OUT = arg("out") ?? "/tmp/sticky-scroll";
// A flat table in the pane's `Scroll` (the Tasks "Sidequests flat" view —
// many columns) and one in a card (a deployment's Deployments card, its "All"
// table view). Both name a view in the URL; pass your own where they differ.
const PAGE_PATH = arg(
  "page-path",
  "/agents/tasks;view.tasks-list=view-da11bc5c-e504-41ad-a788-f886252dfcda",
);
const CARD_PATH = arg(
  "card-path",
  "/deploy/site/dpl-1785501087837-xkt5u5/deployments;view.deploy.deployment.history=all",
);
const SCHEMES = ["light", "dark"] as const;

interface Surface {
  name: string;
  path: string;
  /** The table sits in a card: its own box scrolls, never the pane. */
  inCard: boolean;
}

const SURFACES: Surface[] = [
  { name: "page", path: PAGE_PATH, inCard: false },
  { name: "card", path: CARD_PATH, inCard: true },
];

const header = (page: Page): Locator =>
  page.locator("[data-slot='data-table-header']").first();

/** The table's header geometry, relative to whatever scrolls it sideways. */
interface Probe {
  columns: string[];
  leadPosition: string;
  /** Header cell left edges from the scroller's left edge. */
  lefts: number[];
  pageScrollsX: boolean;
  ownScrolls: boolean;
  scrollLeft: number;
  maxScroll: number;
  /** How far the header row sits below the grid's top (0: on top of its rows). */
  headerDrop: number;
}

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() => {
    const head = document.querySelector<HTMLElement>(
      "[data-slot='data-table-header']",
    )!;
    const grid = head.parentElement!;
    const box = grid.parentElement!;
    const ownScrolls = getComputedStyle(box).overflowX === "auto";
    let scroller: HTMLElement | null = ownScrolls ? box : grid.parentElement;
    while (
      !ownScrolls &&
      scroller &&
      getComputedStyle(scroller).overflowY === "visible"
    ) {
      scroller = scroller.parentElement;
    }
    if (!scroller) throw new Error("no scroller around the table");
    const origin = scroller.getBoundingClientRect().left;
    const cells = [...head.children].filter(
      (c) => c.querySelector("[data-column-id]") !== null,
    );
    return {
      columns: cells.map(
        (c) =>
          c.querySelector<HTMLElement>("[data-column-id]")!.dataset.columnId!,
      ),
      leadPosition: getComputedStyle(cells[0]!).position,
      lefts: cells.map((c) => c.getBoundingClientRect().left - origin),
      pageScrollsX: !!grid.closest("[data-scrolls-x]"),
      ownScrolls,
      scrollLeft: scroller.scrollLeft,
      maxScroll: scroller.scrollWidth - scroller.clientWidth,
      headerDrop:
        head.getBoundingClientRect().top - grid.getBoundingClientRect().top,
    };
  });

const scrollTo = (page: Page, x: number) =>
  page.evaluate((dx) => {
    const grid = document.querySelector<HTMLElement>(
      "[data-slot='data-table-header']",
    )!.parentElement!;
    const box = grid.parentElement!;
    let scroller: HTMLElement | null =
      getComputedStyle(box).overflowX === "auto" ? box : grid.parentElement;
    while (scroller && getComputedStyle(scroller).overflowX !== "auto") {
      scroller = scroller.parentElement;
    }
    scroller!.scrollLeft = dx;
  }, x);

/** Opens a column's header menu and picks `item`. */
async function pickFromMenu(
  page: Page,
  columnId: string,
  item: string,
): Promise<void> {
  await header(page)
    .locator(`[data-column-id="${columnId}"]`)
    .click({ force: true });
  await page.getByRole("menuitem", { name: item }).click();
  await page.waitForTimeout(400);
}

async function dragGrip(page: Page, columnId: string, dx: number) {
  const grip = header(page).locator(`[data-column-grip="${columnId}"]`);
  const b = (await grip.boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Past the gesture's threshold in a few steps, as a hand would.
  await page.mouse.move(x + dx / 2, y, { steps: 5 });
  await page.mouse.move(x + dx, y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(600);
}

const cellWidth = (page: Page, columnId: string) =>
  header(page)
    .locator(`[data-column-id="${columnId}"]`)
    .evaluate(
      (label) =>
        label
          .closest("[data-slot='data-table-header'] > *")!
          .getBoundingClientRect().width,
    );

async function checkResize(r: Report, page: Page, surface: Surface) {
  const before = await probe(page);
  const id = before.columns[1]!;
  const w0 = await cellWidth(page, id);
  await dragGrip(page, id, 60);
  const w1 = await cellWidth(page, id);
  r.ok(
    `${surface.name}: dragging the edge widens the column by 60`,
    Math.abs(w1 - w0 - 60) <= 2,
    `${w0} → ${w1}`,
  );
  await page.reload();
  await header(page).waitFor({ state: "visible" });
  await page.waitForTimeout(800);
  const w2 = await cellWidth(page, id);
  r.ok(
    `${surface.name}: the width persists after a reload`,
    Math.abs(w2 - w1) <= 2,
    `${w1} → ${w2}`,
  );
  await dragGrip(page, id, -60);
  const w3 = await cellWidth(page, id);
  r.ok(
    `${surface.name}: dragging back restores it`,
    Math.abs(w3 - w0) <= 2,
    `${w0} → ${w3}`,
  );
}

async function checkWidth(
  r: Report,
  page: Page,
  surface: Surface,
  label: string,
  wideColumns: string[] | null,
): Promise<string[]> {
  const p = await probe(page);
  // Not sticky (a header cell is `relative`, for its resize grip).
  r.ok(
    `${label}: nothing sticky by default`,
    p.leadPosition !== "sticky",
    p.leadPosition,
  );
  if (wideColumns !== null) {
    r.eq(
      `${label}: no column dropped while narrowing`,
      p.columns.join(","),
      wideColumns.join(","),
    );
    r.ok(`${label}: wider than its box — scrolls sideways`, p.maxScroll > 1);
    if (surface.inCard) {
      r.ok(`${label}: the card's table scrolls its own box`, p.ownScrolls);
      r.eq(`${label}: the pane never scrolls for it`, p.pageScrollsX, false);
      r.ok(
        `${label}: its header sits on top of its rows`,
        Math.abs(p.headerDrop) < 2,
        String(p.headerDrop),
      );
    } else {
      r.ok(`${label}: the pane scrolls sideways`, p.pageScrollsX);
    }
    await checkFreeze(r, page, label, p);
  }
  return p.columns;
}

async function checkFreeze(r: Report, page: Page, label: string, p: Probe) {
  const second = p.columns[1]!;
  await pickFromMenu(page, second, "Freeze up to here");
  const before = await probe(page);
  const by = Math.min(200, before.maxScroll);
  await scrollTo(page, by);
  await page.waitForTimeout(300);
  const after = await probe(page);
  await snap(page, OUT, `${label}-frozen-scrolled`);
  // Column 0 pins at the scroller's edge, column 1 at column 0's width.
  const [b0, b1] = [before.lefts[0]!, before.lefts[1]!];
  const expected = [Math.max(0, b0 - by), Math.max(b1 - by, b1 - b0)];
  r.ok(
    `${label}: the frozen columns stay in view while scrolled`,
    Math.abs(after.lefts[0]! - expected[0]!) < 2 &&
      Math.abs(after.lefts[1]! - expected[1]!) < 2,
    JSON.stringify({ expected, after: after.lefts.slice(0, 2), by }),
  );
  if (before.lefts.length > 2) {
    r.ok(
      `${label}: a later column moves under them`,
      Math.abs(before.lefts[2]! - by - after.lefts[2]!) < 2,
      `${before.lefts[2]} → ${after.lefts[2]}`,
    );
  }
  await scrollTo(page, 0);
  await pickFromMenu(page, second, "Unfreeze columns");
  const reset = await probe(page);
  r.ok(
    `${label}: unfrozen, nothing sticky`,
    reset.leadPosition !== "sticky",
    reset.leadPosition,
  );
}

await withBrowser(async (h) => {
  const r = report("data-table — stable, resizable columns + sideways scroll");
  for (const scheme of SCHEMES) {
    for (const surface of SURFACES) {
      let wideColumns: string[] | null = null;
      for (const width of [1440, 390]) {
        const label = `${surface.name}-${width}-${scheme}`;
        const { page, context, captured } = await h.session({
          colorScheme: scheme,
          viewport: { width, height: 800 },
        });
        await boot(page, pathUrl(surface.path), {
          marker: "[data-slot='data-table-header']",
          settleMs: 800,
        });
        await page.waitForTimeout(500);
        await snap(page, OUT, label);
        if (width === 1440 && scheme === "light" && !surface.inCard) {
          await checkResize(r, page, surface);
        }
        const columns = await checkWidth(r, page, surface, label, wideColumns);
        wideColumns ??= columns;
        const errors = [
          ...captured.pageErrors,
          ...captured.consoleErrors.filter(
            (e) => !/Failed to load resource/.test(e),
          ),
        ];
        r.ok(
          `${label}: no page or console errors`,
          errors.length === 0,
          errors.join("\n"),
        );
        await context.close();
      }
    }
  }
  await r.finish();
});
