/**
 * The live demo comes to rest after quick moves: on the demo page, whose URL
 * keeps the embed's place, moves made faster than the page draws them (a slow
 * device) must end on the last one — never send the embed and the URL back
 * and forth between two places.
 *
 * Plays `--steps` inside the demo (the visible text of what to click, `back`
 * or `forward`, `|`-separated) `--gap` ms apart — timed in the page, so a
 * throttled CPU does not slow the visitor down; a step whose target is not
 * drawn yet (a launcher grid opening) clicks it the frame it shows — at each of `--throttle`'s
 * rates, then watches 10 s with no input: the history writes, React commits
 * and DOM mutations of each second. Settled: no history write and no change of
 * URL after the first `SETTLE_MS`.
 *
 * Manual only — nothing runs this automatically.
 *   ./equin run plugins/apps/plugins/website/plugins/landing/plugins/screenshot/e2e/moves-settle.ts \
 *     [--at /agents] [--steps "All conversations|Agents"] [--gap 0,80,250] [--throttle 4,20] [--end /agents/agents]
 */
import type { Page } from "playwright";
import {
  arg,
  pathUrl,
  report,
  withBrowser,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import {
  RENDER_PROFILER_GLOBAL,
  formatProfilerReport,
  type ProfilerReport,
} from "@plugins/debug/plugins/render-profiler/core";
import { bootDemo, demoPath } from "./internal/demo-pages";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";

export const e2e = {
  kind: "test",
  target: "build",
  writes: false,
  run: {
    manual: ["timing"],
    why: "Plays clicks at fixed gaps under CPU throttling and judges settling within a time window.",
  },
} satisfies E2eScript;

const AT = arg("at") ?? "/agents";
const STEPS = (arg("steps") ?? "All conversations|Agents").split("|");
const GAPS = (arg("gap") ?? "0,80,250").split(",").map(Number);
const THROTTLES = (arg("throttle") ?? "4,20").split(",").map(Number);
/** The place the last step leads to, checked when given. */
const END = arg("end");
const WATCH_MS = 10_000;
/** How long a step waits for what it clicks to be drawn. */
const FIND_MS = 3_000;
/** How long the last move may take to be drawn and written. */
const SETTLE_MS = 4_000;

interface Watched {
  /** Ms after the last input, and the URL written. */
  writes: { at: number; how: string; path: string }[];
  mutations: number[];
  profile: ProfilerReport | null;
  path: string;
  missed: string[];
}

/** Play the steps, then watch the page with no input. */
function playAndWatch(page: Page, gap: number): Promise<Watched> {
  return page.evaluate(
    async ({ steps, gap, watchMs, profilerKey, findMs }) => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const writes: { t: number; how: string; path: string }[] = [];
      const records: number[] = [];
      const push = history.pushState.bind(history);
      const replace = history.replaceState.bind(history);
      history.pushState = (...args) => {
        push(...args);
        writes.push({
          t: performance.now(),
          how: "push",
          path: location.pathname,
        });
      };
      history.replaceState = (...args) => {
        replace(...args);
        writes.push({
          t: performance.now(),
          how: "replace",
          path: location.pathname,
        });
      };
      const observer = new MutationObserver((list) => {
        const t = performance.now();
        for (let i = 0; i < list.length; i++) records.push(t);
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
      const profiler = (window as unknown as Record<string, unknown>)[
        profilerKey
      ] as
        | {
            start(o: { maxDurationMs: number }): void;
            stop(): void;
            getReport(): ProfilerReport;
          }
        | undefined;
      const missed: string[] = [];
      let last = performance.now();
      for (const [i, step] of steps.entries()) {
        if (i > 0) await wait(gap);
        if (step === "back") history.back();
        else if (step === "forward") history.forward();
        else {
          // What to click may not be drawn yet (a launcher grid opening): it
          // is clicked the frame it shows, up to FIND_MS after the step's turn.
          const find = () =>
            [
              ...(document
                .querySelector("[data-app-embed]")
                ?.querySelectorAll<HTMLElement>(
                  "a, button, [role=button], [role=link], [role=menuitem], [role=option]",
                ) ?? []),
            ].find(
              (e) =>
                e.checkVisibility() &&
                [e.innerText.trim(), e.getAttribute("aria-label")].some(
                  (text) => text === step || text?.endsWith(`\n${step}`),
                ),
            );
          let el = find();
          const until = performance.now() + findMs;
          while (el === undefined && performance.now() < until) {
            await new Promise((r) => requestAnimationFrame(r));
            el = find();
          }
          if (el === undefined) {
            missed.push(step);
            continue;
          }
          el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
          el.click();
        }
        last = performance.now();
      }
      profiler?.start({ maxDurationMs: watchMs * 2 });
      await wait(watchMs);
      profiler?.stop();
      observer.disconnect();
      history.pushState = push;
      history.replaceState = replace;
      const mutations = Array<number>(Math.ceil(watchMs / 1000)).fill(0);
      for (const t of records) {
        const second = Math.floor((t - last) / 1000);
        if (second >= 0 && second < mutations.length) mutations[second]! += 1;
      }
      return {
        writes: writes.map((w) => ({
          at: Math.round(w.t - last),
          how: w.how,
          path: w.path,
        })),
        mutations,
        profile: profiler?.getReport() ?? null,
        path: location.pathname,
        missed,
      };
    },
    {
      steps: STEPS,
      gap,
      watchMs: WATCH_MS,
      profilerKey: RENDER_PROFILER_GLOBAL,
      findMs: FIND_MS,
    },
  );
}

await withBrowser(async (h) => {
  const r = report(`demo: ${STEPS.join(" → ")} from ${AT} comes to rest`);
  for (const rate of THROTTLES) {
    for (const gap of GAPS) {
      const { page } = await h.session();
      await bootDemo(page, pathUrl(demoPath(AT)), {
        marker: "[data-app-embed]",
      });
      // The boot's own work (deferred plugins, first reads) is not the moves'.
      await page.waitForTimeout(5000);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      const seen = await playAndWatch(page, gap);
      const name = `${rate}× CPU, ${gap} ms apart`;
      const late = seen.writes.filter((w) => w.at > SETTLE_MS);
      console.info(`${name}: ended at ${seen.path}`);
      console.info(`  mutations per second: ${seen.mutations.join(" ")}`);
      console.info(`  ${seen.writes.length} history writes:`);
      for (const w of seen.writes.slice(0, 30))
        console.info(`    +${w.at} ${w.how} ${w.path}`);
      if (seen.profile !== null)
        console.info(formatProfilerReport(seen.profile, { top: 6 }));
      r.ok(
        `${name}: every step was found`,
        seen.missed.length === 0,
        seen.missed.join(", "),
      );
      r.ok(
        `${name}: no history write after ${SETTLE_MS} ms`,
        late.length === 0,
        `${late.length} writes`,
      );
      if (END !== undefined)
        r.ok(
          `${name}: ends at the last move`,
          seen.path === demoPath(END),
          seen.path,
        );
      await page.context().close();
    }
  }
  await r.finish();
});
