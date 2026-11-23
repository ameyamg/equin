// What kind of failure a rejected `import()` is, from the browser's own error.
//
// An import fails in one of three ways, and they mean different things:
//
// - `fetch` — the browser never got a module of the graph: the request failed,
//   was cancelled or answered an error. The engines say so in one fixed
//   sentence each, always a TypeError, and name no other cause with it:
//     Chromium  "Failed to fetch dynamically imported module: <url>"
//     WebKit    "Importing a module script failed."
//     Firefox   "error loading dynamically imported module: <url>"
//   Only this kind can be the page's network rather than the code: asking
//   again may answer differently (`loadAcrossReachLoss`).
// - `link` — every module arrived, and the graph does not link: an import
//   names a binding its target does not export (or exports ambiguously —
//   Chromium's "contains conflicting star exports for name", Firefox's
//   "contains ambiguous star export:", WebKit's "cannot be resolved by star
//   export entries.").
//     Chromium  SyntaxError "The requested module '<url>' does not provide an export named '<x>'"
//     Firefox   SyntaxError "The requested module '<url>' doesn't provide an export named: '<x>'"
//     WebKit    SyntaxError "Importing binding name '<x>' is not found."
//   SpiderMonkey adds one of its own: a link that failed inside an import
//   cycle after a member of the cycle was already initialized leaves that
//   member unable to link again (`ModuleObject::instantiateFunctionDeclarations`
//   frees its declarations on first use), so the NEXT import reaching the
//   cycle fails with Error "Module function declarations have already been
//   instantiated" — the same link failure, said again. Measured in Firefox
//   159: one missing export in a cycle answers the first import with the
//   SyntaxError and the next with this Error, while WebKit repeats its
//   SyntaxError (equin.ai, 2026-11-22: report-1795348210-yf4ogr and -ocpknv,
//   report-1794951421-uj3kzn).
//   The browser's answer about the bytes it has; asking again repeats it.
// - `other` — anything else: the module's code threw while evaluating, a
//   parse error, or an engine sentence not listed here. Never read as `fetch`:
//   an unknown sentence stays loud (reported under its own message) rather than
//   being retried as if it were the network.

export type ModuleLoadFailure = "fetch" | "link" | "other";

const FETCH_FAILURE =
  /^(?:Failed to fetch dynamically imported module|Importing a module script failed\.|error loading dynamically imported module)/;

const LINK_FAILURE =
  /^(?:The requested module '[^']*' (?:does not provide an export named|contains conflicting star exports for name|doesn't provide an export named:|contains ambiguous star export:)|Importing binding name '[^']*' (?:is not found|cannot be resolved by star export entries)\.)/;

const SPIDERMONKEY_RELINK =
  "Module function declarations have already been instantiated";

export function moduleLoadFailureOf(err: unknown): ModuleLoadFailure {
  if (!(err instanceof Error)) return "other";
  const { message } = err;
  if (err.name === "TypeError" && FETCH_FAILURE.test(message)) return "fetch";
  if (err.name === "SyntaxError" && LINK_FAILURE.test(message)) return "link";
  if (message === SPIDERMONKEY_RELINK) return "link";
  return "other";
}
