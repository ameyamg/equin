import {
  getBootTrace,
  readOpenBootSpans,
} from "@plugins/primitives/plugins/perfs/plugins/boot-trace/web";
import { pageReachRetries } from "@plugins/framework/plugins/web-sdk/core";
import { buildLoadSplit, type LoadSplit } from "../../core";

/**
 * This load's split up to `untilMs`, from the browser's timeline. Every
 * resource, not boot-trace's scripts and styles alone: a boot waits on
 * fetches and fonts too.
 */
export function readLoadSplit(untilMs: number): LoadSplit {
  const [nav] = performance.getEntriesByType(
    "navigation",
  ) as PerformanceNavigationTiming[];
  const trace = getBootTrace();
  const tasksTimed =
    PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false;
  return buildLoadSplit(
    {
      origin: window.location.origin,
      documentEndMs: nav?.responseEnd ?? null,
      resources: performance.getEntriesByType(
        "resource",
      ) as PerformanceResourceTiming[],
      longTasks: tasksTimed ? trace.longTasks : null,
      spans: trace.spans,
      openSpans: readOpenBootSpans(),
      retries: pageReachRetries(),
    },
    untilMs,
  );
}
