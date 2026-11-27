import { useEffect } from "react";
import {
  clientLatencySink,
  type ClientLatencySignal,
} from "@plugins/primitives/plugins/perfs/plugins/latency-signal/core";
import type { ClientLatencyMetric } from "../../core";
import { pausesDuring } from "@plugins/primitives/plugins/perfs/plugins/page-pauses/web";
import {
  flushOnPageHide,
  recordInteraction,
  recordSample,
} from "../internal/client-ledger";
import { startInputTracking } from "../internal/input-tracker";
import {
  cutActiveInteraction,
  startInteractionTracking,
  type NotReady,
} from "../internal/interaction-tracker";
import { useLatestRef } from "@plugins/primitives/plugins/latest-ref/web";
import { useConfig } from "@plugins/config_v2/web";
import {
  MAX_WAITING_FOR,
  MAX_WAITING_FOR_NAME,
  slowOpConfig,
} from "@plugins/debug/plugins/slow-ops/core";
import { clientSlowOpSink } from "@plugins/debug/plugins/slow-ops/plugins/sink/core";
import { getBootTrace } from "@plugins/primitives/plugins/perfs/plugins/boot-trace/web";
import { toClientBootSection } from "@plugins/debug/plugins/trace/plugins/client-boot/core";

// The ledger metric each client latency signal's total is kept as; a signal
// with none (a write's confirm) is left to Debug → Slow Events.
const METRIC_OF: Partial<Record<ClientLatencySignal, ClientLatencyMetric>> = {
  update: "update-e2e",
  "turn-echo": "turn-echo",
};

// A Core.Root side-effect component: mounted once per tab, renders nothing. It
// feeds the browser's measurements into the client ledger — every page
// load, every in-app navigation, the delay of every update a server change
// pushes into this tab, and of every sent message reaching it.
export function LatencyCollector() {
  // The ready budget is slow-ops' page threshold, read as the load begins.
  const cfgRef = useLatestRef(useConfig(slowOpConfig));
  useEffect(
    () =>
      startInteractionTracking(recordInteraction, {
        budgetMs: () => cfgRef.current.pageLoadMs,
        onNotReady: fileNotReady,
      }),
    [cfgRef],
  );
  // Every click and keypress, input → next paint. Interactions happen only in a
  // visible tab, so none is excluded as hidden.
  useEffect(() => startInputTracking((ms) => recordSample("input", ms)), []);

  // Leaving the page: first the load still in flight is cut short and
  // recorded, then everything is sent — in that order, so a page that never
  // settled still leaves its row.
  useEffect(() => {
    const onPageHide = (): void => {
      cutActiveInteraction();
      flushOnPageHide();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  // A signal's total, as its metric (`METRIC_OF`): the update delay (change →
  // pushed frame applied), a sent message shown. A sample the tab spent hidden
  // in (page-pauses, asked over the sample's span — it is emitted at its end)
  // is kept but excluded from the percentiles.
  useEffect(
    () =>
      clientLatencySink.subscribe((sample) => {
        const metric = METRIC_OF[sample.signal];
        if (metric === undefined) return;
        const end = sample.endedAt ?? Date.now();
        const { hiddenMs } = pausesDuring(end - sample.totalMs, end);
        recordSample(metric, sample.totalMs, { excluded: hiddenMs > 0 });
      }),
    [],
  );

  return null;
}

/**
 * A page load still not ready at its budget, filed as the `page-load` slow-op
 * — one per route pattern, naming the reads it waits for. Its duration is a
 * lower bound (`censored`): the ledger's own row keeps how long it really
 * took. The browser's boot decomposition rides along, the trace's client-boot
 * lane.
 */
function fileNotReady(info: NotReady): void {
  // Never under the budget it was judged against (the funnel drops an item
  // whose time is under its bar).
  const durationMs = Math.max(info.budgetMs, Math.round(info.elapsedMs));
  clientSlowOpSink.emit({
    operationKind: "page-load",
    operation: info.route,
    durationMs,
    thresholdMs: info.budgetMs,
    ...(info.done ? {} : { detail: { censored: true as const } }),
    endedAt: Date.now(),
    waitingFor: info.waitingFor
      .slice(0, MAX_WAITING_FOR)
      .map((k) => k.slice(0, MAX_WAITING_FOR_NAME)),
    clientBoot: toClientBootSection(getBootTrace()),
  });
}
