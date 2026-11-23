/**
 * What the tab's rolling stall profiler (web/internal/stall-profiler.ts) costs
 * the page's main thread: every `Profiler` construction and `stop()` the page
 * makes, timed synchronously around the call (the trace is built inside
 * `stop()` — blink's ProfilerTraceBuilder — before it returns), with the size
 * of the trace it produced, and every profiler the page let go of (dropped
 * unstopped, so V8 discards it without building a trace) as it is collected.
 *
 * Per path and CPU throttle: open the page, stay on it `--seconds` (the
 * profiler rotates every 30 s), print each call. `--gc-every <s>` forces a
 * garbage collection that often, to see let-go profilers collected.
 *
 * Manual only. Run after `./equin build`:
 *   ./equin run plugins/reports/plugins/main-thread-stall/e2e/profiler-cost.ts \
 *     --paths /agents,/pages [--cpu 1,4,6] [--seconds 95] [--composition website]
 */
import {
  arg,
  numArg,
  pathUrl,
  report,
  withBrowser,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";

export const e2e = {
  kind: "tool",
  target: "build",
  writes: false,
  run: {
    manual: ["heavy"],
    why: "Stays 95 s per path per CPU throttle to measure profiler cost.",
  },
} satisfies E2eScript;

const PATHS = (arg("paths") ?? "/").split(",");
const CPUS = (arg("cpu") ?? "1,4,6").split(",").map(Number);
const SECONDS = numArg("seconds", 95);
/** Force a garbage collection this often (s; 0: never) — do let-go profilers get collected? */
const GC_EVERY = numArg("gc-every", 0);
const r = report("stall profiler → main-thread cost");

interface Call {
  kind: "start" | "stop";
  at: number;
  ms: number;
  via: string;
  samples?: number;
  stacks?: number;
  frames?: number;
}
interface Probe {
  calls: Call[];
  collected: number;
  constructed: number;
}

// Runs in the page before any of its scripts: wraps `Profiler` so every
// construction and stop is timed where it happens.
function instrument(): void {
  const g = globalThis as unknown as {
    Profiler?: new (o: unknown) => { stop(): Promise<unknown> };
    __profilerProbe?: unknown;
  };
  const Real = g.Profiler;
  if (!Real) return;
  const probe = { calls: [] as unknown[], collected: 0, constructed: 0 };
  g.__profilerProbe = probe;
  const gone = new FinalizationRegistry<number>(() => {
    probe.collected++;
  });
  const via = (): string =>
    (new Error().stack ?? "")
      .split("\n")
      .slice(2, 6)
      .map((l) =>
        l
          .trim()
          .replace(/^at /, "")
          .replace(/ \(.*$/, ""),
      )
      .join(" ← ");
  class Timed extends Real {
    constructor(o: unknown) {
      const t = performance.now();
      super(o);
      probe.calls.push({
        kind: "start",
        at: t,
        ms: performance.now() - t,
        via: via(),
      });
      probe.constructed++;
      gone.register(this, 0);
    }
    override stop(): Promise<unknown> {
      const t = performance.now();
      const p = super.stop();
      const call: Record<string, unknown> = {
        kind: "stop",
        at: t,
        ms: performance.now() - t,
        via: via(),
      };
      probe.calls.push(call);
      void p.then((trace) => {
        const tr = trace as {
          samples: unknown[];
          stacks: unknown[];
          frames: unknown[];
        };
        call.samples = tr.samples.length;
        call.stacks = tr.stacks.length;
        call.frames = tr.frames.length;
      });
      return p;
    }
  }
  g.Profiler = Timed;
}

await withBrowser(async (h) => {
  for (const path of PATHS) {
    for (const cpu of CPUS) {
      const { page } = await h.session();
      await page.addInitScript(instrument);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
      await page.goto(pathUrl(path));
      if (GC_EVERY > 0)
        for (let t = 0; t < SECONDS; t += GC_EVERY) {
          await page.waitForTimeout(Math.min(GC_EVERY, SECONDS - t) * 1000);
          await cdp.send("HeapProfiler.collectGarbage");
        }
      else await page.waitForTimeout(SECONDS * 1000);
      const probe = await page.evaluate(
        () =>
          (globalThis as unknown as { __profilerProbe?: Probe })
            .__profilerProbe ?? null,
      );
      r.ok(`${path} ${cpu}×: the page has a Profiler`, probe !== null);
      if (!probe) continue;
      const stops = probe.calls.filter((c) => c.kind === "stop");
      const starts = probe.calls.filter((c) => c.kind === "start");
      const fmt = (n: number): string => n.toFixed(1);
      console.log(
        `\n== ${path} at ${cpu}× CPU, ${SECONDS} s: ${starts.length} started, ${stops.length} stopped, ${probe.collected} collected (stopped or let go)`,
      );
      for (const c of probe.calls)
        console.log(
          `  ${(c.at / 1000).toFixed(1).padStart(6)} s ${c.kind.padEnd(5)} ${fmt(c.ms).padStart(7)} ms` +
            (c.kind === "stop"
              ? `  samples=${c.samples ?? "?"} stacks=${c.stacks ?? "?"} frames=${c.frames ?? "?"}`
              : "") +
            `  via ${c.via}`,
        );
      const total = stops.reduce((s, c) => s + c.ms, 0);
      const max = stops.reduce((m, c) => Math.max(m, c.ms), 0);
      console.log(
        `  stop total ${fmt(total)} ms, max ${fmt(max)} ms; start total ${fmt(starts.reduce((s, c) => s + c.ms, 0))} ms`,
      );
      await page.context().close();
    }
  }
});
await r.finish();
