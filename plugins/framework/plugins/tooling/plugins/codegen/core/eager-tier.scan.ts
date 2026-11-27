import {
  defaultExportObjectBody,
  findImports,
  findMarkerCalls,
  hasField,
  matchBracket,
  lineAt,
  markerCallSpans,
  maskSource,
  parseStringField,
  parseStaticCallId,
  unresolvableCallIdMessage,
} from "@plugins/plugin-meta/plugins/parse-utils/core";
import {
  mintsOf,
  resourceDescriptorFactories,
  type PreloadFlag,
} from "@plugins/network/plugins/live/plugins/resource-vocabulary/core";
import type { FileScan } from "@plugins/plugin-meta/plugins/plugin-records/core";

// The eager-tier generator's per-file scan (`eager-tier-gen.ts`). A scan's
// records are keyed by its module's whole closure (`FileScan.url`), so this
// module holds the scan and the code it runs, and nothing else.

// The slot factories whose contributions always-eager chrome draws at boot.
// Each is guarded on the file also importing `head` from an `@plugins/`
// specifier, so a bare textual mention of the member cannot false-positive.
//
// `Shell.Sidebar` is an app shell's sidebar (the agent manager's), drawn by the
// eager shell in the first frame: a contribution left in the deferred tier
// would be INSERTED into a sidebar already on screen once that tier lands,
// pushing every row below it down (the "New conversation" row, CLS 0.128 on a
// filmed cold load of /agents — research/2026-11-12-global-load-model-redesign.md §2).
const WATCHED_SLOTS: { marker: string; head: string }[] = [
  { marker: "Core.Root", head: "Core" },
  { marker: "Core.Boot", head: "Core" },
  { marker: "Apps.App", head: "Apps" },
  { marker: "ActionBar.Item", head: "ActionBar" },
  { marker: "Shell.Sidebar", head: "Shell" },
];

// The descriptor factories that can carry a `preload:` field (in a trailing
// options object, or a declaration's spec) come from the shared vocabulary
// (`tooling/resource-vocabulary/core`), whose key set `tsc` derives from the
// live-state, query-resource and network/live barrels themselves.
//
// The generator used to keep its own four-name list, and the docs facet kept a
// different three-name one. Neither knew the five bounded-membership factories,
// so a preloaded bounded descriptor (then declared with its own window
// factory; today a `liveCollection(…, { preload: "boot" })`) under
// `apps/plugins/**` was invisible here: the plugin stayed deferred, its
// descriptor was not registered before the boot snapshot hydrated, and the
// surface painted the pending state it was designed never to show. Every miss
// looked exactly like a plugin declaring nothing.
//
// Each name must still be a DISTINCT identifier for the textual scan (a
// factory name is matched as a whole identifier, never inside a longer one),
// which is what `findMarkerCalls` guarantees.
const DESCRIPTOR_FACTORIES = Object.entries(resourceDescriptorFactories);

/** Every identifier imported from any `@plugins/` specifier in `src`. */
function pluginImportedIdents(src: string): Set<string> {
  const idents = new Set<string>();
  // `findImports` masks comments/regex/strings and reads specifiers by offset,
  // so an import written inside a string/comment never contributes idents.
  for (const imp of findImports(src)) {
    if (imp.keyword !== "import" || imp.sideEffect) continue;
    if (!imp.specifier.startsWith("@plugins/")) continue;
    // `clause` excludes `from`/quotes/`;`, so this is the same token set the old
    // bindings-capture word-scan collected.
    for (const w of imp.clause.match(/[A-Za-z_$][\w$]*/g) ?? []) idents.add(w);
  }
  return idents;
}

/** The first watched boot slot `text` genuinely calls (with its head imported), or null. */
function watchedSlotIn(text: string): string | null {
  const idents = pluginImportedIdents(text);
  for (const { marker, head } of WATCHED_SLOTS) {
    if (!idents.has(head)) continue;
    if (!text.includes(marker)) continue; // cheap fast-path
    if (findMarkerCalls(text, marker).length > 0) return marker;
  }
  return null;
}

/** One file's eager-tier answers: its first watched slot, its preloaded keys, and — a web barrel's — the modules its contributions' slots come from. */
export const EAGER_TIER_SCAN: FileScan<{
  watched: string | null;
  preload: string[];
  contributionSources: string[] | null;
}> = {
  url: import.meta.url,
  scan: (text, rel) => ({
    watched: watchedSlotIn(text),
    preload: preloadedKeysIn(text, rel, { ownerPlugin: false }),
    contributionSources: WEB_BARREL_RE.test(rel)
      ? contributionSourcesIn(text)
      : null,
  }),
};

/** A plugin's web barrel: `…/web/index.ts(x)`. */
const WEB_BARREL_RE = /\/web\/index\.tsx?$/;

/** The local names an import clause binds (`A`, `{ B, C as D }`, `* as E`), type-only members left out. */
function boundNames(clause: string): string[] {
  const names: string[] = [];
  const brace = /\{([^}]*)\}/.exec(clause);
  for (const member of brace?.[1]!.split(",") ?? []) {
    const m = /^\s*(type\s+)?[\w$]+(?:\s+as\s+([\w$]+))?\s*$/.exec(member);
    if (!m || m[1]) continue;
    names.push(m[2] ?? /[\w$]+/.exec(member)![0]);
  }
  const outside = brace ? clause.replace(brace[0], "") : clause;
  const star = /\*\s*as\s+([\w$]+)/.exec(outside);
  if (star) names.push(star[1]!);
  const dflt = /^\s*([\w$]+)\s*(?:,|$)/.exec(
    outside.replace(/\*\s*as\s+[\w$]+/, ""),
  );
  if (dflt && dflt[1] !== "type") names.push(dflt[1]!);
  return names;
}

/** The top-level elements of an array literal's interior (masked text), split on depth-0 commas. */
function topLevelElements(
  masked: string,
  from: number,
  to: number,
): [number, number][] {
  const out: [number, number][] = [];
  let start = from;
  for (let i = from; i < to; i++) {
    const c = masked[i]!;
    if (c === "(" || c === "[" || c === "{") {
      i = matchBracket(masked, i, c, c === "(" ? ")" : c === "[" ? "]" : "}");
      if (i < 0) return [];
    } else if (c === ",") {
      out.push([start, i]);
      start = i + 1;
    }
  }
  out.push([start, to]);
  return out.filter(([a, b]) => masked.slice(a, b).trim() !== "");
}

/**
 * The module specifiers a web barrel's contributions' slots come from — the
 * `@plugins/…` import binding the head of each `contributions: [Head.Slot({…}), …]`
 * element — or null when the barrel cannot be read that way: no
 * `contributions` array literal, an element that is not one slot call, a head
 * not imported from an `@plugins/` specifier (its own `./slots`, a local
 * helper), or a barrel declaring `slots` of its own (a host, not only a
 * contributor). Null is the safe answer: the plugin's code stays its folder
 * app's (eager-tier-gen's `computeEagerTier`).
 */
export function contributionSourcesIn(src: string): string[] | null {
  const body = defaultExportObjectBody(src);
  if (body.kind !== "object") return null;
  if (hasField(body.body, "slots", { depth0: true })) return null;
  const masked = maskSource(body.body);
  // `contributions:` at the object's depth 0.
  let open = -1;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i]!;
    if (c === "(" || c === "[" || c === "{") {
      i = matchBracket(masked, i, c, c === "(" ? ")" : c === "[" ? "]" : "}");
      if (i < 0) return null;
      continue;
    }
    const m = /^contributions\s*:\s*\[/.exec(masked.slice(i, i + 40));
    if (m && (i === 0 || /[\s,]/.test(masked[i - 1]!))) {
      open = i + m[0].length - 1;
      break;
    }
  }
  if (open < 0) return null;
  const close = matchBracket(masked, open, "[", "]");
  if (close < 0) return null;
  const elements = topLevelElements(masked, open + 1, close);
  if (elements.length === 0) return null;
  const sourceOf = new Map<string, string>();
  for (const imp of findImports(src)) {
    if (imp.keyword !== "import" || imp.sideEffect || imp.typeOnly) continue;
    if (!imp.specifier.startsWith("@plugins/")) continue;
    for (const name of boundNames(imp.clause))
      sourceOf.set(name, imp.specifier);
  }
  const sources = new Set<string>();
  for (const [a, b] of elements) {
    const text = masked.slice(a, b).trim();
    const call = /^([\w$]+)(?:\.[\w$]+)*\s*\(/.exec(text);
    if (!call) return null;
    const paren = text.indexOf("(", call[1]!.length);
    if (matchBracket(text, paren, "(", ")") !== text.length - 1) return null;
    const source = sourceOf.get(call[1]!);
    if (source === undefined) return null;
    sources.add(source);
  }
  return [...sources].sort();
}

/**
 * Every preloaded descriptor key in ONE source file, in source order.
 *
 * Every factory spells its preload flag the same way — a `preload:` field,
 * read through the shared vocabulary — where `"boot"` and `"boot-and-keep"`
 * both preload (the second only adds a client-side resident cache) and
 * `"none"` does not. Only the mints the flag reaches (`preloadable`) are
 * preloaded: a collection's preload hydrates its default window, never its
 * `:rows` / `:groups` siblings.
 *
 * The file is FULL-masked (so a factory written inside a comment, string or
 * template literal is never matched) and each key is read back from the
 * ORIGINAL by offset. THROWS — naming `displayPath`, the line and the offending
 * expression — on a preloaded declaration whose key is not a static string
 * literal, and on a `preload:` whose value is not a literal (or not one of the
 * three spellings). The key used to fall back to `"(unknown)"`, which pins the
 * plugin eager (right) but names it in the manifest as a key that matches
 * nothing (wrong, and silent). A preloaded resource is one whose absence before
 * first paint is a visible loading flash, so the one thing this scan must not do
 * is guess.
 *
 * `ownerPlugin` skips the file entirely: inside the plugins that OWN the
 * factories (`isResourceVocabularyOwner`), a factory call is the wrapper
 * IMPLEMENTING one — `liveCollection` forwarding a caller's `preload` to the
 * window descriptor it mints under a computed key — not a plugin declaring a
 * resource. The declaration site is the caller's.
 * The docs facet's index exempts the same plugins through the same predicate.
 */
export function preloadedKeysIn(
  src: string,
  displayPath: string,
  opts: { ownerPlugin: boolean },
): string[] {
  if (opts.ownerPlugin) return [];
  const keys: string[] = [];
  let masked: string | null = null;
  for (const [factory, entry] of DESCRIPTOR_FACTORIES) {
    if (!src.includes(factory)) continue; // cheap fast-path
    masked ??= maskSource(src);
    for (const span of markerCallSpans(masked, factory)) {
      // A factory's own declaration (`function liveValue<T>(key, spec: …)`,
      // an overload included) is no call: its "spec" is a parameter list.
      if (/\bfunction\s*$/.test(masked.slice(0, span.identifier))) continue;
      const argsText = src.slice(span.open + 1, span.close);
      const where = { file: displayPath, line: lineAt(src, span.identifier) };
      // The mints this call's spec actually makes — one reading, shared with
      // the docs facet (`requires`: a collection's `k` is its window under
      // `default`, its whole set under `all`, never both). Read BEFORE the
      // preload test: a spec whose fields are not in the call's text (an
      // identifier, a wrapper call) hides its `preload:` too, and mintsOf
      // throws on it instead of letting it read as "not preloaded".
      const mints = mintsOf(entry, argsText, where);
      if (!preloadsBoot(factory, entry.preload, argsText, where)) continue;
      const id = parseStaticCallId(src, span);
      if (id.kind !== "value") {
        throw new Error(
          unresolvableCallIdMessage({
            marker: factory,
            ...where,
            expr: id.kind === "dynamic" ? id.expr : "",
            hint:
              "A preloaded descriptor pins its plugin into the eager " +
              "load tier, and this manifest is built from source text — so the key " +
              "must be a literal at the declaration site. Inline the literal " +
              "instead of hoisting or interpolating it.",
          }),
        );
      }
      for (const m of mints) {
        if (m.preloadable) keys.push(id.value + m.suffix);
      }
    }
  }
  return keys;
}

/**
 * Whether one factory call's args preload. Throws on a non-literal `preload:`
 * and on a literal that is not one of the vocabulary's spellings.
 */
function preloadsBoot(
  factory: string,
  flag: PreloadFlag,
  argsText: string,
  where: { file: string; line: number },
): boolean {
  const field = parseStringField(argsText, flag.field);
  if (field.kind === "absent") return false;
  if (field.kind === "dynamic") {
    throw new Error(
      `${where.file}:${where.line}: ${factory}(…) \`${flag.field}:\` is not a ` +
        `static string literal — got \`${field.expr}\`. It decides whether this ` +
        "declaration pins its plugin into the eager load tier, and this manifest " +
        "is built from source text — write the literal at the declaration site.",
    );
  }
  if (flag.preloads.includes(field.value)) return true;
  if (flag.none.includes(field.value)) return false;
  throw new Error(
    `${where.file}:${where.line}: ${factory}(…) \`${flag.field}: ${JSON.stringify(field.value)}\` ` +
      `is not a preload spelling — expected one of ` +
      `${[...flag.none, ...flag.preloads].map((v) => JSON.stringify(v)).join(", ")}.`,
  );
}
