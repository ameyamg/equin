// A window error the browser muted, and when that proves it is not ours.
//
// A classic script whose response is not CORS-same-origin (another origin's,
// fetched without CORS) is "muted": an error raised in it reaches the page as
// message "Script error.", line and column 0, no error object (the HTML spec's
// muted errors; Chromium and WebKit also clear the filename, Firefox may keep
// it). An error equin's own scripts throw is never muted: every one of them is
// a module (whose muted flag is always false: modules are fetched in CORS
// mode, so a cross-origin one without CORS fails to load instead) or one of
// the document's own inline scripts.
//
// That alone does not make a muted error someone else's bug. Our code calling a
// cross-origin library wrongly (a destroyed YouTube player, an invalid Google
// Maps value) has the library throw inside its own script, which reaches us
// muted just the same. So the verdict is `foreign` only while the document
// holds no cross-origin `<script src>` of the page's (a library loaded from
// another http(s) origin): then the muted script is one the page never loaded —
// an extension's, injected and gone, or one on an extension scheme. With such
// a library present, the error is left unjudged.
//
// equin.ai, 2026-11-18 → 11-26: 344 stackless "Script error."s
// (report-1795714186-8inqlu). The verdict downgrades, it never mutes: the
// report is still filed, as reports/crash's `[not our code]`.

const MUTED_MESSAGE = "Script error.";

/** Whether `e` is the browser's muted form of a non-CORS classic script's error. */
export function isMutedScriptError(e: ErrorEvent): boolean {
  return (
    (e.error === null || e.error === undefined) &&
    e.message === MUTED_MESSAGE &&
    e.lineno === 0 &&
    e.colno === 0
  );
}

/**
 * Whether the document holds a classic script the page loaded from another
 * http(s) origin — a library whose throw may be our call gone wrong.
 */
export function documentHasCrossOriginScript(): boolean {
  return Array.from(document.scripts).some((s) => {
    if (!s.src) return false;
    const url = new URL(s.src, document.baseURI);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin !== window.location.origin
    );
  });
}

/** Whether a window error is provably not this page's code: muted, with no library of the page's to blame. */
export function isForeignMutedError(e: ErrorEvent): boolean {
  return isMutedScriptError(e) && !documentHasCrossOriginScript();
}
