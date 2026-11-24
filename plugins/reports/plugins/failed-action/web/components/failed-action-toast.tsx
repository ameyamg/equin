import { useEffect } from "react";
import { pageCodeOrigin } from "@plugins/reports/plugins/crash/web";
import { useEventCallback } from "@plugins/primitives/plugins/latest-ref/web";
import { useToast } from "@plugins/shell/plugins/notifications/web";
import { watchInputDispatch } from "../internal/input-dispatch";

/** One toast for "your action failed": a new failure replaces the one on screen. */
const REPLACE_KEY = "failed-action";
/** The bell keeps one row per failure, bumped in place within this window. */
const RESURFACE_AFTER_MS = 10 * 60_000;

/**
 * The tab's own answer when a user's action crashes: an error thrown while the
 * browser is still dispatching the click / key / submit that caused it
 * (`internal/input-dispatch.ts`) raises "That didn't work" here, at once and
 * on every occurrence. The crash itself is filed by the crash collector as
 * usual — its report and bell notification are de-duplicated telemetry; this
 * is the direct answer to the click, which they swallowed (11 silent clicks
 * on a dead sidebar row, 2026-11-24, report-1795534089-iyie4i).
 *
 * Repeats replace the toast on screen rather than stacking (`replaces`), so
 * each click still visibly answers — the new toast animates in.
 */
export function FailedActionToast() {
  // Read through a stable callback: `useToast`'s identity follows write
  // availability, and re-subscribing would drop the open-dispatch stack mid-click.
  const toast = useEventCallback(useToast());

  useEffect(() => {
    const { watch, stop } = watchInputDispatch(window);
    const onError = (e: ErrorEvent) => {
      if (watch.current() === null) return;
      const err = e.error instanceof Error ? e.error : null;
      // A browser extension's listener failing on the user's keystroke is not
      // the page's action failing (crash § A browser extension's error says so).
      if (err !== null && pageCodeOrigin(err.stack) === "foreign") return;
      const message = err === null ? e.message : `${err.name}: ${err.message}`;
      toast({
        type: "failed-action",
        category: "other",
        variant: "error",
        title: "That didn't work",
        description: "Something went wrong. It has been reported.",
        detail: message,
        replaces: REPLACE_KEY,
        dedupe: {
          key: `failed-action:${message}`,
          resurfaceAfterMs: RESURFACE_AFTER_MS,
        },
      });
    };
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("error", onError);
      stop();
    };
  }, [toast]);

  return null;
}
