// How fast opening a thread shows its body: a PREFETCHED thread (its body
// stored by the cache's prefetch before the click) against a COLD one (never
// stored: the reader's read fetches it from the provider).
//
//   ./equin run plugins/apps/plugins/mail/plugins/reader/e2e/open-speed.ts \
//     [--wait-ms 60000] [--samples 4] [--out "$EQUIN_SCRATCH/mail-read.json"]
//
// Opens /mail (the Inbox), waits `--wait-ms` for the prefetch the list read
// started (the Inbox's unread first page and its top 25), then clicks:
//
//   prefetched — rows 1–`samples` of the Inbox (the top of the view, which
//                prefetch takes first);
//   cold       — read rows past the 25th of the Inbox, then of Sent and Done
//                (opened from the sidebar; each one's top 25 are prefetched,
//                the rest are not), spaced 8 apart so no sample is a neighbour the
//                previous open prefetched.
//
// Per click, from the click: the first frame the reading pane shows the
// thread's last message body — its fitted frame laid out (height > 0), or its
// text. Each sample is taken in a requestAnimationFrame after a DOM mutation,
// so it is the frame the browser paints. Which arm a sample really was is
// confirmed after the run from `mail_thread_bodies.fetched_at` (the script
// prints the thread ids and click times).

import { writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import type { Page } from "playwright";
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
    why: "Times opening threads on a connected Gmail account, prefetched and cold.",
  },
} satisfies E2eScript;

const waitMs = numArg("wait-ms", 60_000);
const samples = numArg("samples", 4);
const out = arg("out");

type Arm = "prefetched" | "cold";
interface Sample {
  arm: Arm;
  threadId: string;
  clickedAt: string;
  bodyMs: number;
  frame: boolean;
  loadAvg: number;
}

/** The thread ids of the rows on screen, in order, with whether each is unread. */
async function listedRows(
  page: Page,
): Promise<{ id: string; unread: boolean }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-row-key]")].map((el) => ({
      id: el.getAttribute("data-row-key") ?? "",
      unread: el.querySelector("[data-unread]") !== null,
    })),
  );
}

/** Clicks a row and times the first painted frame with its last message's body. */
async function openAndTime(
  page: Page,
  threadId: string,
): Promise<{ bodyMs: number; frame: boolean }> {
  await page.evaluate((id) => {
    const w = window as unknown as {
      __read?: { t0: number; ms: number | null; frame: boolean };
    };
    const state = {
      t0: performance.now(),
      ms: null as number | null,
      frame: false,
    };
    w.__read = state;
    let scheduled = false;
    const sample = (frameMs: number) => {
      scheduled = false;
      if (state.ms !== null) return;
      const pane = document.querySelector(
        `[data-mail-thread="${CSS.escape(id)}"]`,
      );
      const last = pane?.querySelectorAll("[data-mail-message]");
      const msg = last?.[last.length - 1];
      if (msg) {
        const frame = msg.querySelector("iframe");
        if (frame === null || frame.getBoundingClientRect().height > 0) {
          state.ms = frameMs - state.t0;
          state.frame = frame !== null;
          observer.disconnect();
          return;
        }
      }
      schedule();
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(sample);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    // The fitted frame's height arrives as a style change: mutations cover it.
    schedule();
  }, threadId);
  await page.click(`[data-row-key="${threadId}"]`);
  await page.waitForFunction(
    () =>
      (window as unknown as { __read?: { ms: number | null } }).__read?.ms !=
      null,
    undefined,
    { timeout: 60_000 },
  );
  return page.evaluate(() => {
    const s = (window as unknown as { __read: { ms: number; frame: boolean } })
      .__read;
    return { bodyMs: s.ms, frame: s.frame };
  });
}

/** Cold candidates: read rows past the 25th, `gap` apart. */
function coldPicks(
  rows: { id: string; unread: boolean }[],
  n: number,
  gap = 8,
): string[] {
  const out: string[] = [];
  for (let i = 26; i < rows.length && out.length < n; i += gap) {
    const r = rows[i];
    if (r && !r.unread) out.push(r.id);
  }
  return out;
}

const all = await withBrowser(async (h) => {
  const context = await h.browser.newContext({
    viewport: { ...DEFAULT_VIEWPORT },
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await page.goto(pathUrl("/mail"));
  await page.waitForSelector("[data-row-key]", { timeout: 120_000 });
  // The list read started the prefetch; give it its run.
  await page.waitForTimeout(waitMs);
  const inbox = await listedRows(page);
  console.log(`Inbox: ${inbox.length} rows listed`);
  const results: Sample[] = [];
  const take = async (arm: Arm, id: string) => {
    const clickedAt = new Date().toISOString();
    const loadAvg = loadavg()[0] ?? NaN;
    const r = await openAndTime(page, id);
    results.push({ arm, threadId: id, clickedAt, loadAvg, ...r });
    console.log(
      `  ${arm.padEnd(10)} ${id} at ${clickedAt}: body in ${Math.round(r.bodyMs)} ms (${r.frame ? "html" : "text"}, load ${loadAvg.toFixed(1)})`,
    );
  };
  for (const r of inbox.slice(0, samples)) await take("prefetched", r.id);
  for (const id of coldPicks(inbox, samples)) await take("cold", id);
  // Other views: each one's head is prefetched once read; past it is cold.
  for (const view of ["Sent", "Done"]) {
    await page.getByRole("button", { name: view, exact: true }).first().click();
    await page.waitForTimeout(5_000);
    const rows = await listedRows(page);
    for (const id of coldPicks(rows, samples)) await take("cold", id);
  }
  await context.close();
  return results;
});

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : (s[Math.floor((s.length - 1) / 2)] ?? NaN);
};
for (const arm of ["prefetched", "cold"] as Arm[]) {
  const xs = all.filter((s) => s.arm === arm).map((s) => s.bodyMs);
  console.log(
    `${arm}: body ${Math.round(median(xs))} ms median (${Math.round(Math.min(...xs))}–${Math.round(Math.max(...xs))}), n=${xs.length}`,
  );
}
if (out !== undefined) writeFileSync(out, JSON.stringify(all, null, 2));
