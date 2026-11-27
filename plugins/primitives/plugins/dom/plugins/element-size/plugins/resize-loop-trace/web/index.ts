import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export {
  claimsResizeLoopError,
  installResizeLoopTrace,
  resizeLoopReportSink,
  type ResizeLoopHeldBack,
  type ResizeLoopObservation,
  type ResizeLoopReport,
} from "./internal/resize-loop-trace";

export default {
  description:
    "Names the observers behind a 'ResizeObserver loop completed with undelivered notifications' error, which the browser raises with no stack: installResizeLoopTrace() (imported first by main.tsx) wraps the page's ResizeObserver to remember the callbacks of the current pass, where each observer was created and the size each observation last reported. When the loop error fires it reads which observations are still out of date (resized or detached since they last reported, or never reported) — exactly the notifications the browser held back — and emits, on resizeLoopReportSink, ONE report per episode (loop errors less than a second apart, cut at 10 s): its first error's pass, held-back observations and next step, with how many errors it raised and for how long. claimsResizeLoopError(e) tells the window-error reporter the tracer reports this one.",
  contributions: [],
} satisfies PluginDefinition;
