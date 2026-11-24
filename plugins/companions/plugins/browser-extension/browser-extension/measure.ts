/**
 * Measure a tab for the recorder (`core/viewport.ts`'s `TabMeasure`): its
 * window from `chrome.windows`, its zoom, and — from a script run in the page
 * (`activeTab` grants it for the tab the popup or ⌥⇧R was opened on) — the
 * page's viewport, its device pixel ratio and the display's work area.
 */
import type { TabMeasure } from "../core/viewport";
import { chrome } from "./chrome-api";

/** How long a page may take to report a resize Chrome already applied: a
 *  bound around Chrome's own layout, which we do not control. */
const SETTLE_MS = 1500;

interface PageMeasure {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  workArea: { left: number; top: number; width: number; height: number };
}

/**
 * `tabId`'s measure. With `settleTo`, the page is first given until its next
 * `resize` (bounded) to reach that size — after a window resize, the page's
 * viewport follows a frame or more later.
 */
export async function measureTab(
  tabId: number,
  settleTo?: { width: number; height: number },
): Promise<TabMeasure> {
  const tab = await chrome.tabs.get(tabId);
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [settleTo ?? null, SETTLE_MS] as [
      { width: number; height: number } | null,
      number,
    ],
    // Serialized into the page: self-contained, no closures.
    func: async (
      target: { width: number; height: number } | null,
      settleMs: number,
    ): Promise<PageMeasure> => {
      const read = (): PageMeasure => {
        const s = screen as Screen & { availLeft?: number; availTop?: number };
        return {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
          workArea: {
            left: s.availLeft ?? 0,
            top: s.availTop ?? 0,
            width: s.availWidth,
            height: s.availHeight,
          },
        };
      };
      const fits = () =>
        target !== null &&
        window.innerWidth === target.width &&
        window.innerHeight === target.height;
      if (target !== null && !fits())
        await new Promise<void>((resolve) => {
          const done = () => {
            if (!fits()) return;
            window.removeEventListener("resize", done);
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(() => {
            window.removeEventListener("resize", done);
            resolve();
          }, settleMs);
          window.addEventListener("resize", done);
        });
      // One more frame, so the layout the capture sees is the new one.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      return read();
    },
  });
  const page = injected?.result;
  if (page === undefined)
    throw new Error("Chrome did not let the extension read this page.");
  const win = await chrome.windows.get(tab.windowId);
  return {
    window: {
      left: win.left ?? 0,
      top: win.top ?? 0,
      width: win.width ?? page.innerWidth,
      height: win.height ?? page.innerHeight,
    },
    windowState: win.state ?? "normal",
    innerWidth: page.innerWidth,
    innerHeight: page.innerHeight,
    devicePixelRatio: page.devicePixelRatio,
    zoom: await chrome.tabs.getZoom(tabId),
    workArea: page.workArea,
  };
}
