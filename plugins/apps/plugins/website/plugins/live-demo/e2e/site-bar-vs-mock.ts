// The demo page's site bar against its mockup (proto-1795644492-p8e9ne),
// pixel by pixel: the bar alone is captured in each page at the same device
// scale, and the two crops are diffed (`diffImages`) — the whole screens
// would differ everywhere (the mock is drawn over a home gallery, the app
// over a running demo).
//
// Usage:
//   ./equin run plugins/apps/plugins/website/plugins/live-demo/e2e/site-bar-vs-mock.ts \
//     --mock-url "<the prototype's document URL, from ./equin prototype options>" \
//     [--out <prefix>] [--scale 2]
//
// Writes `<out>-mock.png`, `<out>-app.png`, `<out>-diff.png` and
// `<out>-side-by-side.png`; logs both boxes, the differing-pixel ratio
// (--threshold, default 0.1; 0 counts any change) and the colour report (ΔE
// of the dominant colours and regions, drift line 2 — just noticeable).
import { writeFileSync } from "node:fs";
import {
  arg,
  numArg,
  requireArg,
  pathUrl,
  withBrowser,
  diffImages,
  heatmapText,
  colorReport,
  colorReportText,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";
import { demoPagePath } from "@plugins/apps/plugins/website/plugins/live-demo/core";

export const e2e = {
  kind: "tool",
  target: "build",
  writes: false,
  run: {
    manual: ["arguments"],
    why: "Needs the prototype's document URL, which only the prototype CLI prints.",
  },
} satisfies E2eScript;

const mockUrl = requireArg(
  "mock-url",
  "site-bar-vs-mock.ts --mock-url <prototype document URL> [--out <prefix>] [--scale 2] [--threshold 0.1]",
);
const out = arg("out", "/tmp/site-bar");
const scale = numArg("scale", 2);
/** The pixel diff's YIQ threshold: 0 counts any change at all. */
const threshold = numArg("threshold", 0.1);
const viewport = { width: 1400, height: 900 };

await withBrowser(async (h) => {
  const { page: mock } = await h.session({
    viewport,
    colorScheme: "dark",
    deviceScaleFactor: scale,
  });
  await mock.goto(mockUrl, { waitUntil: "load" });
  const mockBar = mock.locator("#dbar");
  await mockBar.waitFor();
  await mock.evaluate(() => document.fonts.ready);

  const { page: app } = await h.session({
    viewport,
    colorScheme: "dark",
    deviceScaleFactor: scale,
  });
  await app.goto(pathUrl(demoPagePath(undefined)), {
    waitUntil: "domcontentloaded",
  });
  const appBar = app.locator("[data-demo-site-bar]");
  await appBar.waitFor();
  await app.evaluate(() => document.fonts.ready);
  await app.waitForTimeout(1000);

  const a = await mockBar.screenshot();
  const b = await appBar.screenshot();
  console.log(`mock box: ${JSON.stringify(await mockBar.boundingBox())}`);
  console.log(`app box:  ${JSON.stringify(await appBar.boundingBox())}`);
  const d = await diffImages(app, a, b, {
    threshold,
    labels: ["mock", "app"],
    grid: { cols: 8, rows: 2 },
  });
  writeFileSync(`${out}-mock.png`, a);
  writeFileSync(`${out}-app.png`, b);
  writeFileSync(`${out}-diff.png`, d.diffPng);
  writeFileSync(`${out}-side-by-side.png`, d.sideBySidePng);
  console.log(
    `size: mock ${d.a.width}×${d.a.height}, app ${d.b.width}×${d.b.height}${d.sameSize ? "" : " (DIFFERENT)"}`,
  );
  console.log(
    `differing: ${d.differing}/${d.total} px (${(d.ratio * 100).toFixed(2)}%)`,
  );
  console.log(heatmapText(d.grid));
  // The pixel diff passes a surface one shade off: colour is its own report.
  const colors = await colorReport(app, a, b, {
    labels: ["mock", "app"],
    deltaE: 2,
  });
  console.log(colorReportText(colors));
  console.log(`wrote ${out}-side-by-side.png`);
});
