import type { RepoSnapshot } from "@plugins/framework/plugins/tooling/core";
import { scanRepoFiles } from "@plugins/plugin-meta/plugins/plugin-records/core";
import {
  resolveSpecifier,
  specifierPath,
} from "@plugins/plugin-meta/plugins/plugin-records/plugins/specifier/core";
import { PAGE_IMPORTS_SCAN } from "./page-imports.scan";

// What the geometry suite's verdict is a function of, read from the code
// itself: the files the suite and the page it builds actually load.
//
// The suite builds ONE page (Vite + Tailwind) from `web/internal/entry.tsx`,
// which reads the exhibit catalog through its generated registry — a dynamic
// `import()` of every contributor's `exhibits/index.ts` — and measures the
// measured exhibits (isolated and region ones) by rendering them. So the
// page's code is the static import closure of:
//
//   - every file of the harness plugin itself (the suite, the page entry and
//     its HTML, the Vite build script spawned by path, the oracle, this check);
//   - every contributor's exhibits barrel — what the registry loads.
//
// What is NOT followed is a dynamic `import()` anywhere else. In an exhibits
// barrel that is an `appExhibit`'s `load()`: the component behind it needs the
// live app, the measurer page never calls it (`appExhibit` cannot carry a
// geometry — a tsc error), so its code reaches no measured box. Following it
// pulled whole apps into the key: an edit to `hints/help-menu` re-ran the
// Chromium suite (~40 s, the pass's critical path) because `hints` contributes
// an app exhibit, while a primitive a measured exhibit imports from outside
// the contributor's subtree was not keyed at all.
//
// Tailwind's own `@source` scan (app.css names all of `plugins/`) is not
// followed either: a class spelled only in a file outside the closure adds a
// rule for a class no loaded module puts on a measured box. The closure's own
// sources (whose candidates do reach the page) and the stylesheet chain
// (`@import` / `@reference` / `@plugin` / `@config`, followed below) are keyed.
// Packages are keyed by `bun.lock` (Vite, Tailwind, React, Playwright).
//
// Every fact goes through the run's `RepoSnapshot`, so in an input-keyed check
// the read-set is exactly this closure: an edit outside it replays the cached
// pass without running the check. That is why the walk is its own, not the
// plugin-records module graph's: the graph grows every module's whole reach,
// `import()`s included — an app exhibit's `load()` would put whole apps back
// in the read-set. Each specifier (script, asset or `@import`) is resolved by
// the graph's own resolver (`plugin-records/specifier`), so the walk and the
// graph cannot place one differently.
//
// The walk costs what changed, not the closure. A file is keyed by its blob id
// (`blobOf`: the snapshot's own id, recorded as a content fact of the
// read-set, no file call), and its imports are a file record keyed by that
// blob (`page-imports.scan.ts`, read through `scanRepoFiles`): only a file no
// pass has scanned yet is read — as the record store's shared work, not the
// check's own. Reading every file's bytes on each run that missed its
// read-set made the check's own body ~990 file calls, right at the
// whole-tree bound (1001 on 2026-11-27, failing a push).

export const HARNESS_ROOT =
  "plugins/primitives/plugins/css/plugins/layout-harness";

/** A plugin's own `exhibits/` barrel — what the generated registry loads. */
const EXHIBITS_BARREL_RE =
  /^plugins\/[^/]+(?:\/plugins\/[^/]+)*\/exhibits\/index\.tsx?$/;

const SCANNED_RE = /\.(?:tsx?|mts|cts|jsx?|mjs|cjs|css)$/;
const LOCKFILE = "bun.lock";
const CHECK_DIR = `${HARNESS_ROOT}/check/`;

/** The static specifiers of each of `files` (`page-imports.scan.ts`'s answer), in order. */
export type ScanSpecifiers = (files: readonly string[]) => Promise<string[][]>;

/** What the walk reads of the run's file set: paths, membership and blob ids — never bytes. */
export type PageRepo = Pick<RepoSnapshot, "under" | "glob" | "has" | "blobOf">;

/**
 * The repo file `specifier` (written in `rel`) names — or null for a package,
 * keyed by the lockfile. A repo specifier naming no file of the run throws: a
 * key that skipped it could not be invalidated by the code it names.
 */
function repoTarget(
  rel: string,
  specifier: string,
  repo: Pick<RepoSnapshot, "has">,
): string | null {
  if (specifierPath(rel, specifier) === null) return null;
  const target = resolveSpecifier(rel, specifier, (p) => repo.has(p));
  if (target === null)
    throw new PageInputError(
      `${rel}: imports "${specifier}", which names no file of the run`,
    );
  return target;
}

export class PageInputError extends Error {}

export interface PageInputs {
  /** Every repo file the page and its suite load, sorted. */
  files: string[];
  /** Their blob ids, in `files` order. */
  blobs: string[];
}

/**
 * The static import closure of the harness and every exhibits barrel, with
 * each file's blob id, each file's imports read off its file record. Throws
 * (`PageInputError`) on an import it cannot place: a key that skipped it
 * could not be invalidated by the code it names.
 */
export function pageInputs(repo: RepoSnapshot): Promise<PageInputs> {
  return pageInputsWith(repo, (files) =>
    scanRepoFiles(repo, files, PAGE_IMPORTS_SCAN),
  );
}

/** {@link pageInputs} over any file set, its per-file specifiers from `scan`. */
export async function pageInputsWith(
  repo: PageRepo,
  scan: ScanSpecifiers,
): Promise<PageInputs> {
  const seeds = [
    ...repo.under(HARNESS_ROOT),
    ...repo
      .glob("plugins/**/exhibits/index.ts*")
      .filter((p) => EXHIBITS_BARREL_RE.test(p)),
    LOCKFILE,
  ];
  const blobs = new Map<string, string>();
  let frontier = [...new Set(seeds)];
  while (frontier.length > 0) {
    for (const rel of frontier) {
      if (!repo.has(rel))
        throw new PageInputError(
          `${rel}: in the page's closure but not in the run's file set`,
        );
      blobs.set(rel, repo.blobOf(rel));
    }
    // The check's own code is keyed by its bytes; what it imports (spawn,
    // host admission, the deps engine) runs the suite but shapes no geometry.
    const scanned = frontier.filter(
      (rel) => !rel.startsWith(CHECK_DIR) && SCANNED_RE.test(rel),
    );
    const specifiers = await scan(scanned);
    const next = new Set<string>();
    scanned.forEach((rel, i) => {
      for (const spec of specifiers[i]!) {
        const target = repoTarget(rel, spec, repo);
        if (target !== null && !blobs.has(target)) next.add(target);
      }
    });
    frontier = [...next];
  }
  const files = [...blobs.keys()].sort();
  return { files, blobs: files.map((f) => blobs.get(f)!) };
}
