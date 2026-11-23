/**
 * The helper every page of the engine runs (a context init script, top frame
 * only), reporting to the host through the {@link ENGINE_BINDING} binding.
 * What the screencast cannot carry, it reports instead:
 *
 * - `cursor` — the CSS cursor under the pointer, on change (the host moves the
 *   pointer with `Input.dispatchMouseEvent`, so `mousemove` fires as usual).
 * - `meta` — the document's title and favicon, at load and on every `<title>`
 *   / `<link rel=icon>` change (a MutationObserver — never polled).
 * - `select` — a native `<select>` popup is drawn outside the page, so never
 *   in a screencast frame: its `mousedown` is cancelled and the options + box
 *   reported; the client draws the menu and answers with the picked value.
 * - `open` — a new tab the page asks for that needs no opener: a link that
 *   opens a new tab (`target=_blank` without `rel=opener`, a Cmd / Shift /
 *   middle click) or `window.open(url, "_blank", "noopener")`. The open is
 *   cancelled before Chromium sees it and the host opens the URL itself as a
 *   background tab: a tab or window Chromium creates for a page always shows
 *   its window — a background tab of the minimized one included (measured
 *   2026-11-24, Chrome 158) — restoring it onto the user's desktop. An open
 *   that keeps an opener (`window.open` without `noopener`: sign-in popups
 *   talk to their opener) stays Chromium's, and so does one from a frame.
 *
 * Plain browser JavaScript serialised into the page: no imports, no closures
 * over host values.
 */
export const ENGINE_BINDING = "__equinEngine";

/** What the page script reports (the binding's one argument). */
export type PageReport =
  | { kind: "cursor"; value: string }
  | { kind: "meta"; title: string; favicon: string | null }
  | {
      kind: "open";
      url: string;
      /** The referrer to send ("" for none), and the policy that trims it. */
      referrer: string;
      referrerPolicy: string;
    }
  | {
      kind: "select";
      options: {
        value: string;
        label: string;
        disabled: boolean;
        selected: boolean;
      }[];
      rect: { x: number; y: number; width: number; height: number };
    };

/** The two globals the page script shares with the host (the binding, the open select). */
interface EngineWindow {
  __equinEngine?: (report: PageReport) => Promise<void>;
  __equinEngineSelect?: HTMLSelectElement | null;
}

/** Runs in the page (stringified by Playwright's `addInitScript`). */
export function pageScript(): void {
  if (window !== window.top) return;
  const w = window as unknown as EngineWindow;
  const report = (r: PageReport): void => {
    const send = w.__equinEngine;
    if (send) void send(r);
  };

  // ── cursor ───────────────────────────────────────────────────────────
  let lastCursor = "";
  const cursorAt = (target: EventTarget | null): string => {
    if (!(target instanceof Element)) return "default";
    const css = getComputedStyle(target).cursor;
    if (css !== "auto") return css;
    if (target.closest("a[href]")) return "pointer";
    if (
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement &&
        ![
          "button",
          "submit",
          "reset",
          "checkbox",
          "radio",
          "range",
          "color",
          "file",
        ].includes(target.type)) ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return "text";
    }
    // Text content shows the I-beam in a real browser.
    for (const node of Array.from(target.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        return "text";
      }
    }
    return "default";
  };
  document.addEventListener(
    "mousemove",
    (e) => {
      const value = cursorAt(e.target);
      if (value === lastCursor) return;
      lastCursor = value;
      report({ kind: "cursor", value });
    },
    { capture: true, passive: true },
  );

  // ── title + favicon ──────────────────────────────────────────────────
  let lastMeta = "";
  const reportMeta = (): void => {
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    const meta = {
      kind: "meta" as const,
      title: document.title,
      favicon: link?.href || null,
    };
    const key = JSON.stringify(meta);
    if (key === lastMeta) return;
    lastMeta = key;
    report(meta);
  };
  const observe = (): void => {
    reportMeta();
    new MutationObserver((records) => {
      for (const r of records) {
        const el =
          r.target instanceof Element ? r.target : r.target.parentElement;
        if (el?.closest("title, link") || r.type === "childList") {
          reportMeta();
          return;
        }
      }
    }).observe(document.head ?? document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["href", "rel"],
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observe, { once: true });
  } else {
    observe();
  }

  // ── <select> popups ──────────────────────────────────────────────────
  document.addEventListener(
    "mousedown",
    (e) => {
      if (!(e.target instanceof Element)) return;
      const select = e.target.closest("select");
      if (!select || select.multiple || select.size > 1 || select.disabled) {
        return;
      }
      e.preventDefault();
      // A press does not scroll the page; neither does the focus it stood for.
      select.focus({ preventScroll: true });
      w.__equinEngineSelect = select;
      const box = select.getBoundingClientRect();
      report({
        kind: "select",
        options: Array.from(select.options).map((o) => ({
          value: o.value,
          label: o.label || o.text,
          disabled: o.disabled,
          selected: o.selected,
        })),
        rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
    },
    true,
  );

  // ── new tabs ─────────────────────────────────────────────────────────
  // Chromium's popup blocker: a page opens a window only while it has a
  // user activation (a trusted click or key just now) — so does the host.
  const active = (): boolean => navigator.userActivation.isActive;
  const webUrl = (raw: string): string | null => {
    let url: URL;
    try {
      url = new URL(raw, document.baseURI);
    } catch (err) {
      if (err instanceof TypeError) return null;
      throw err;
    }
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  };
  const opensNewContext = (target: string | null | undefined): boolean =>
    !target || target.toLowerCase() === "_blank";

  // Links. The open is cancelled up front (an activation behaviour cannot be
  // cancelled once dispatch ends) and happens once dispatch ended — unless the
  // page cancelled the click itself. The page sees its own cancel, not ours.
  const onLinkClick = (e: MouseEvent): void => {
    // A primary click, or a middle one (`auxclick` fires for every other
    // button too). Option-click downloads.
    if (e.button !== (e.type === "auxclick" ? 1 : 0) || e.altKey) return;
    const link = e
      .composedPath()
      .find(
        (n): n is HTMLAnchorElement | HTMLAreaElement =>
          n instanceof HTMLAnchorElement || n instanceof HTMLAreaElement,
      );
    if (!link || link.hasAttribute("download")) return;
    const url = webUrl(link.href);
    if (!url) return;
    const rel = link.relList;
    const modified = e.button === 1 || e.metaKey || e.ctrlKey || e.shiftKey;
    const blank =
      link.target.toLowerCase() === "_blank" && !rel.contains("opener");
    if (!modified && !blank) return;
    if (!e.isTrusted && !active()) return;
    e.preventDefault();
    let prevented = false;
    Object.defineProperties(e, {
      defaultPrevented: { get: () => prevented, configurable: true },
      returnValue: {
        get: () => !prevented,
        set: (v: boolean) => {
          if (!v) prevented = true;
        },
        configurable: true,
      },
      preventDefault: {
        value: () => {
          if (e.cancelable) prevented = true;
        },
        configurable: true,
      },
    });
    setTimeout(() => {
      if (prevented) return;
      // Read once dispatch ended: a handler may have rewritten the link.
      const final = webUrl(link.href) ?? url;
      const noReferrer = link.relList.contains("noreferrer");
      report({
        kind: "open",
        url: final,
        referrer: noReferrer ? "" : document.URL,
        referrerPolicy: link.referrerPolicy,
      });
    }, 0);
  };
  window.addEventListener("click", onLinkClick, true);
  window.addEventListener("auxclick", onLinkClick, true);

  // `window.open` with `noopener` returns null: nothing can tell the host
  // opened it. Wrapped in a Proxy, so it still reads as native code.
  const flag = (features: string, name: string): boolean => {
    for (const part of features.split(",")) {
      const [k = "", v] = part.split("=").map((x) => x.trim().toLowerCase());
      if (k !== name) continue;
      return v === undefined || v === "" || v === "yes" || Number(v) !== 0;
    }
    return false;
  };
  window.open = new Proxy(window.open, {
    apply(native, self, args: unknown[]) {
      const [rawUrl, target, rawFeatures] = args;
      const features = typeof rawFeatures === "string" ? rawFeatures : "";
      const noReferrer = flag(features, "noreferrer");
      const url =
        rawUrl === undefined || rawUrl === null ? null : webUrl(String(rawUrl));
      if (
        url &&
        (noReferrer || flag(features, "noopener")) &&
        opensNewContext(target === undefined ? null : String(target)) &&
        active()
      ) {
        report({
          kind: "open",
          url,
          referrer: noReferrer ? "" : document.URL,
          referrerPolicy: "",
        });
        return null;
      }
      return Reflect.apply(native, self, args) as Window | null;
    },
  });
}

/** Apply the value picked in the client's menu to the select it was opened on. */
export function applySelect(value: string | null): void {
  const w = window as unknown as EngineWindow;
  const select = w.__equinEngineSelect;
  w.__equinEngineSelect = null;
  if (!select || value === null || select.value === value) return;
  select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The page's current selection — an input's or textarea's selected text first. */
export function readSelection(): string {
  const el = document.activeElement;
  if (
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
    el.selectionStart !== null &&
    el.selectionEnd !== null
  ) {
    return el.value.slice(el.selectionStart, el.selectionEnd);
  }
  return window.getSelection()?.toString() ?? "";
}
