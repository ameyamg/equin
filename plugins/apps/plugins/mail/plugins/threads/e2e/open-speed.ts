// How fast opening Mail shows the Inbox's first row, with and without the
// Inbox preload (the cache's `preloadWindows`, which puts the Inbox's page 0
// into Mail's own boot snapshot).
//
//   ./equin run plugins/apps/plugins/mail/plugins/threads/e2e/open-speed.ts \
//     [--iterations 8] [--out "$EQUIN_SCRATCH/mail-open.json"]
//
// One browser context (no Playwright route — any route disables the HTTP
// cache), warmed by one load of /mail, so every measured load has the app's
// code cached and the server's Mail cache warm: a returning user. Loads then
// alternate between two arms:
//
//   on  — the page as served: its head asks the snapshot for Mail's tuples
//         (`?app=apps/plugins/mail/`).
//   off — the same page, its snapshot request stripped of `app=` by an init
//         script wrapping `fetch` (the server then answers no app tuples), so
//         the Inbox loads after first paint as it did before the preload.
//
// Per load, times from navigation start (performance.timeOrigin):
//   - snapshot: the boot snapshot response's end (Resource Timing)
//   - firstData: the boot's first-data-commit mark
//   - list: the first frame the threads DataView's search box is on screen
//   - firstRow: the first frame a thread row (`[data-row-key]`) is on screen
//   - busyFrames: frames between `list` and `firstRow` in which a loading
//     placeholder (`[aria-busy=true]`) was on the page — 0, and
//     list == firstRow, means the Inbox painted with its rows, no loading state.
// Each sample is taken in a requestAnimationFrame after the DOM mutation, so
// it is the frame the browser paints.

import { loadavg } from "node:os";
import { writeFileSync } from "node:fs";
import type { BrowserContext } from "playwright";
import {
  arg,
  DEFAULT_VIEWPORT,
  numArg,
  pathUrl,
  withBrowser,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";

export const e2e = {
  kind: "tool",
  target: "build",
  writes: false,
  run: {
    manual: ["accounts", "timing"],
    why: "Times opening Mail on a connected Gmail account, several loads.",
  },
} satisfies E2eScript;

const iterations = numArg("iterations", 8);
const out = arg("out");
const url = pathUrl("/mail");

type Arm = "on" | "off";

interface LoadRow {
  arm: Arm;
  loadAvg: number;
  snapshotUrl: string;
  snapshotEndMs: number;
  firstDataMs: number | null;
  listMs: number;
  firstRowMs: number;
  busyFrames: number;
  rows: number;
}

/** Installed before the app: frame-accurate first-list / first-row stamps. */
function observeInit(arm: Arm): void {
  if (arm === "off") {
    const realFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === "string" && input.includes("boot-snapshot?app=")) {
        input = input.replace(/\?app=[^&]*&?/, "?").replace(/\?$/, "");
      }
      return realFetch(input, init);
    }) as typeof fetch;
  }
  const state = {
    listMs: null as number | null,
    firstRowMs: null as number | null,
    busyFrames: 0,
    rows: 0,
  };
  (window as unknown as { __mailOpen: typeof state }).__mailOpen = state;
  let scheduled = false;
  const sample = (frameMs: number) => {
    scheduled = false;
    if (state.firstRowMs !== null) return;
    const search = document.querySelector('input[placeholder^="Search "]');
    if (search === null) return;
    if (state.listMs === null) state.listMs = frameMs;
    const rows = document.querySelectorAll("[data-row-key]").length;
    if (rows > 0) {
      state.firstRowMs = frameMs;
      state.rows = rows;
      return;
    }
    if (document.querySelector('[aria-busy="true"]')) state.busyFrames++;
    schedule();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(sample);
  };
  new MutationObserver(schedule).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
  });
}

async function measure(context: BrowserContext, arm: Arm): Promise<LoadRow> {
  const page = await context.newPage();
  await page.addInitScript(observeInit, arm);
  const loadAvg = loadavg()[0] ?? NaN;
  await page.goto(url, { waitUntil: "commit" });
  await page.waitForFunction(
    () =>
      (window as unknown as { __mailOpen?: { firstRowMs: number | null } })
        .__mailOpen?.firstRowMs != null,
    undefined,
    { timeout: 60_000 },
  );
  const r = await page.evaluate(() => {
    const s = (
      window as unknown as {
        __mailOpen: {
          listMs: number;
          firstRowMs: number;
          busyFrames: number;
          rows: number;
        };
      }
    ).__mailOpen;
    const snap = performance
      .getEntriesByType("resource")
      .filter(
        (e): e is PerformanceResourceTiming =>
          e instanceof PerformanceResourceTiming,
      )
      .find((e) => e.name.includes("/api/resources/boot-snapshot"));
    const fd = performance
      .getEntriesByType("mark")
      .find((m) => m.name.endsWith("first-data-commit"));
    return {
      ...s,
      snapshotUrl: snap?.name ?? "(none)",
      snapshotEndMs: snap === undefined ? NaN : snap.responseEnd,
      firstDataMs: fd === undefined ? null : fd.startTime,
    };
  });
  await page.close();
  return { arm, loadAvg, ...r };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : (s[Math.floor((s.length - 1) / 2)] ?? NaN);
};
const fmt = (xs: number[]) =>
  `${Math.round(median(xs))} ms (${Math.round(Math.min(...xs))}–${Math.round(Math.max(...xs))})`;

const rows = await withBrowser(async (h) => {
  const context = await h.browser.newContext({
    viewport: { ...DEFAULT_VIEWPORT },
    colorScheme: "dark",
  });
  await measure(context, "on");
  await measure(context, "off");
  const all: LoadRow[] = [];
  for (let i = 0; i < iterations; i++) {
    for (const arm of (i % 2 === 0 ? ["on", "off"] : ["off", "on"]) as Arm[]) {
      const row = await measure(context, arm);
      all.push(row);
      console.log(
        `  #${i + 1} ${arm.padEnd(3)} load ${row.loadAvg.toFixed(1)}: snapshot ${Math.round(row.snapshotEndMs)} ms, ` +
          `first data ${Math.round(row.firstDataMs ?? NaN)} ms, list ${Math.round(row.listMs)} ms, ` +
          `first row ${Math.round(row.firstRowMs)} ms (+${Math.round(row.firstRowMs - row.listMs)} after list, ` +
          `${row.busyFrames} loading frames, ${row.rows} rows)`,
      );
    }
  }
  await context.close();
  return all;
});

for (const arm of ["on", "off"] as Arm[]) {
  const r = rows.filter((x) => x.arm === arm);
  console.log(
    `${arm === "on" ? "preload ON " : "preload OFF"}: first row ${fmt(r.map((x) => x.firstRowMs))}; ` +
      `list ${fmt(r.map((x) => x.listMs))}; row after list ${fmt(r.map((x) => x.firstRowMs - x.listMs))}; ` +
      `snapshot ${fmt(r.map((x) => x.snapshotEndMs))}; loads with a loading frame ${r.filter((x) => x.busyFrames > 0).length}/${r.length}` +
      ` (snapshot url ${r[0]?.snapshotUrl.replace(/^.*\/api/, "/api")})`,
  );
}
if (out !== undefined) writeFileSync(out, JSON.stringify(rows, null, 2));
