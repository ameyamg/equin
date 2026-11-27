import type { FileScan } from "@plugins/plugin-meta/plugins/plugin-records/core";

// The specifiers one file of the geometry page's closure loads WITH it, as
// the per-file scan layout-geometry keeps as file records: a file's static
// imports are a function of its bytes and path, so a pass whose closure moved
// reads and scans only the files whose blob no pass has scanned yet — never
// the whole ~1k-file closure again (`page-inputs.ts`).
//
// - a script: its static imports, type-only ones erased (Bun's transpiler —
//   what the bundle loads); an `import()` is left out (see `page-inputs.ts`);
// - a stylesheet: its `@import` / `@reference` / `@plugin` / `@config`;
// - anything else (HTML, a `.d.ts`, the lockfile): nothing.

const SCRIPT_RE = /\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/;
const CSS_RE = /\.css$/;

// `@import "x"`, `@import url("x")`, `@reference "x"`, `@plugin "x"`, `@config "x"`.
const CSS_IMPORT_RE =
  /@(?:import|reference|plugin|config)\s+(?:url\(\s*)?["']([^"']+)["']/g;

/** The static specifiers `src` (the bytes of `rel`) loads, in source order. */
export function staticSpecifiers(src: string, rel: string): string[] {
  if (CSS_RE.test(rel))
    return [...src.matchAll(CSS_IMPORT_RE)].map((m) => m[1]!);
  if (!SCRIPT_RE.test(rel) || rel.endsWith(".d.ts")) return [];
  const loader = rel.endsWith(".tsx") || rel.endsWith(".jsx") ? "tsx" : "ts";
  return new Bun.Transpiler({ loader })
    .scanImports(src)
    .filter((i) => i.kind !== "dynamic-import")
    .map((i) => i.path);
}

export const PAGE_IMPORTS_SCAN: FileScan<string[]> = {
  url: import.meta.url,
  scan: (src, rel) => staticSpecifiers(src, rel),
};
