import { useEffect } from "react";
import { useAudience } from "@plugins/audience/web";
import {
  watchScrollLoss,
  watchStateLoss,
} from "@plugins/primitives/plugins/kept-state/plugins/loss-detector/web";
import { report } from "@plugins/reports/web";
import type { ReloadLossPayload } from "@plugins/reports/plugins/reload-loss/core";

/**
 * Runs the dev unmount detector and its scroll watch for a developer
 * (Developer mode on): every piece of React state a remount throws away, and
 * every pane's main scroller the user scrolled that nothing keeps, is filed as
 * a `reload-loss` report. Off for a user — the detector follows every commit, which only a
 * developer dogfooding the app should pay for. Renders nothing.
 */
export function ReloadLossController(): null {
  const audience = useAudience();
  const developer =
    audience.status === "ready" && audience.data === "developer";
  useEffect(() => {
    if (!developer) return;
    const stopScroll = watchScrollLoss((loss) => {
      const data = {
        origin: "scroll",
        pane: loss.pane,
        ...(loss.uiOwner !== undefined ? { uiOwner: loss.uiOwner } : {}),
        ...(loss.source !== undefined ? { source: loss.source } : {}),
        offset: loss.offset,
      } satisfies ReloadLossPayload;
      void report({
        kind: "reload-loss",
        source: "client-reload-loss",
        message: `Reload loss: ${loss.uiOwner ?? loss.source ?? "a pane"} scroller (${loss.offset}) is kept by nothing`,
        url: window.location.href,
        userAgent: navigator.userAgent,
        data,
      });
    });
    const stopState = watchStateLoss((loss) => {
      const data = {
        origin: "unmount",
        scope: loss.scope,
        component: loss.component,
        owners: loss.owners.slice(-8),
        stateIndex: loss.stateIndex,
        ...(loss.source !== undefined ? { source: loss.source } : {}),
        ...(loss.uiOwner !== undefined ? { uiOwner: loss.uiOwner } : {}),
        value: loss.value,
      } satisfies ReloadLossPayload;
      void report({
        kind: "reload-loss",
        source: "client-reload-loss",
        message: `Reload loss: ${loss.component} state #${loss.stateIndex} (${loss.value}) thrown away by a remount`,
        url: window.location.href,
        userAgent: navigator.userAgent,
        data,
      });
    });
    return () => {
      stopScroll();
      stopState();
    };
  }, [developer]);
  return null;
}
