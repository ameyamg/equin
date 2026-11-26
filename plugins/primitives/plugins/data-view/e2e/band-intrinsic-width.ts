// Verifies that a DataView toolbar in a host sized to its content cannot
// render-loop (report-1795711185-g5kpk7): the band's intrinsic width is the
// same whatever form it draws, so the stage it picks never moves the width it
// is measured from.
//
// On Home (the app grid's capsule toolbar), the column is made a
// shrink-to-fit float inside a box of each width below, then the band is
// watched for 700ms: it must not mutate, its width must be the room below
// the compact breakpoint (folded) and the breakpoint at or above it (wide).
// Before the fix the band flipped 181 <-> 390px at every width.
//
//   ./equin run plugins/primitives/plugins/data-view/e2e/band-intrinsic-width.ts
import {
  pathUrl,
  report,
  withBrowser,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";

export const e2e = {
  kind: "test",
  target: "build",
  writes: false,
  run: "auto",
} satisfies E2eScript;

const ROOMS = [250, 300, 355, 365, 380, 600];
const BREAKPOINT = 360;

await withBrowser(async (h) => {
  const r = report("DataView band in a content-sized host");
  const { page } = await h.session({
    viewport: { width: 800, height: 900 },
    colorScheme: "dark",
  });
  await page.goto(pathUrl("/home"));
  await page.locator('[data-part="dv.toolbar"]').first().waitFor();
  await page.waitForTimeout(1500);

  for (const room of ROOMS) {
    const m = await page.evaluate(async (room) => {
      const band = () =>
        document.querySelector<HTMLElement>('[data-part="dv.toolbar"]')!;
      const col = band().closest<HTMLElement>(".mx-auto")!;
      col.parentElement!.style.width = `${room}px`;
      col.style.cssText = "float:left;width:auto;margin:0";
      await new Promise((res) => setTimeout(res, 500));
      let mutations = 0;
      const b = band();
      const mo = new MutationObserver((list) => (mutations += list.length));
      mo.observe(b, { subtree: true, childList: true, attributes: true });
      await new Promise((res) => setTimeout(res, 700));
      mo.disconnect();
      return {
        mutations,
        width: Math.round(b.getBoundingClientRect().width),
        overflow: b.scrollWidth - b.clientWidth,
      };
    }, room);
    const want = Math.min(room, BREAKPOINT);
    r.ok(
      `room ${room}px: the band holds still at ${want}px`,
      m.mutations === 0 && m.width === want && m.overflow === 0,
      JSON.stringify(m),
    );
  }
});
