// The generic "rewrite a namespace's saved config once" ledger.
//
// A namespace's USER-layer config (`~/.equin/state/config/<ns>/gens/<id>/`) is not
// in git, so no commit can carry a change to it — and a hand-run migration is a
// step that gets skipped. Instead the backend deriving a config generation
// (config_v2#machine) replays committed, keyed entries onto the user layer it
// starts from, right before it propagates the git config into it, and records
// each applied key in a per-ledger marker file, so an entry runs exactly once
// per namespace. Two ledgers ride this engine:
//
//   - plugin moves (`plugin-meta/relocate`): files follow a moved plugin and
//     saved reorder keys are re-rooted;
//   - config migrations (`defineConfigMigration`, config_v2): a descriptor's
//     saved values are rewritten after its schema changed shape.
//
// Both rewrite `.jsonc` documents whose `// @hash` headers chain: an override
// records the hash of the default (origin) it was written against. Rewriting
// that default changes its hash, which would mark the override stale and let
// the default win — the very loss a migration exists to prevent. So
// `rewriteConfigFiles` rewrites snapshots (origins, ancestors) first, collects
// each old → new hash pair, and re-stamps every override anchored to an old one.

import { z } from "zod";
import {
  computeHash,
  configTextHash,
  parseConfigText,
  withConfigTextHash,
  type JsonValue,
} from "../../../core";

const appliedSchema = z.object({ applied: z.array(z.string()) });

/**
 * One user-layer directory's files, by dir-relative forward-slash path — what
 * every ledger and the propagation rewrite. Held in memory
 * ({@link memoryConfigTree}): the backend that derives a config generation
 * reads the files it starts from, rewrites them here, and writes the result
 * out, so nothing on this path waits on the disk.
 */
export interface ConfigTree {
  /** Every file's path, sorted. */
  paths(): string[];
  /** One file's text, or null when the tree has none. */
  read(path: string): string | null;
  write(path: string, text: string): void;
  /** Remove one file; a no-op when absent. */
  remove(path: string): void;
}

/** A {@link ConfigTree} over `files` (taken over, not copied). */
export function memoryConfigTree(
  files: Map<string, string> = new Map(),
): ConfigTree & { readonly files: ReadonlyMap<string, string> } {
  return {
    files,
    paths: () => [...files.keys()].sort(),
    read: (path) => files.get(path) ?? null,
    write: (path, text) => {
      files.set(path, text);
    },
    remove: (path) => {
      files.delete(path);
    },
  };
}

function readApplied(tree: ConfigTree, file: string): Set<string> {
  const text = tree.read(file);
  if (text === null) return new Set();
  return new Set(appliedSchema.parse(JSON.parse(text)).applied);
}

function writeApplied(
  tree: ConfigTree,
  file: string,
  applied: Set<string>,
): void {
  tree.write(file, `${JSON.stringify({ applied: [...applied] }, null, 2)}\n`);
}

/** The keys of `keys` that `tree` has not applied yet, in order. */
export function unappliedLedgerKeys(opts: {
  tree: ConfigTree;
  markerFile: string;
  keys: readonly string[];
}): string[] {
  const applied = readApplied(opts.tree, opts.markerFile);
  return opts.keys.filter((k) => !applied.has(k));
}

export interface ConfigLedgerEntry<R> {
  /** Stable, unique within the ledger — what the marker records. */
  readonly key: string;
  /** Rewrite the namespace's files; what it returns is reported back. */
  apply(tree: ConfigTree): R;
}

/**
 * Apply, in order, every entry `tree` has not applied yet, recording each key
 * in `<markerFile>` right after it runs. A `fresh` namespace (nothing saved
 * yet) has nothing to rewrite: every entry is recorded without running. The
 * marker is not `.jsonc`, so neither the config registry nor the orphan audit
 * reads it.
 */
export function runConfigLedger<R>(opts: {
  tree: ConfigTree;
  markerFile: string;
  fresh: boolean;
  entries: readonly ConfigLedgerEntry<R>[];
}): { key: string; result: R }[] {
  const { tree, markerFile, fresh, entries } = opts;
  const applied = readApplied(tree, markerFile);
  const out: { key: string; result: R }[] = [];
  for (const entry of entries) {
    if (applied.has(entry.key)) continue;
    if (!fresh) out.push({ key: entry.key, result: entry.apply(tree) });
    applied.add(entry.key);
    writeApplied(tree, markerFile, applied);
  }
  return out;
}

const MERGE_RECORD_SUFFIX = ".merge.jsonc";

const isSnapshot = (f: string) =>
  f.endsWith(".origin.jsonc") || f.endsWith(".ancestor.jsonc");

/**
 * Rewrite the `.jsonc` files of `tree` that `select` picks through `rewrite`
 * (text in, text out; return it unchanged to leave a file alone), keeping the
 * hash chain: each rewritten snapshot gets the hash of its new content, and
 * each override whose header named a rewritten snapshot's old hash is
 * re-stamped with the new one (an automatic-merge record — header and
 * `toHash` — too). Returns the rewritten files, sorted.
 */
export function rewriteConfigFiles(
  tree: ConfigTree,
  opts: {
    select?: (rel: string) => boolean;
    rewrite: (rel: string, text: string) => string;
    /** The hash a rewritten snapshot is stamped with (default: its content's
     *  own). A ledger that knows the document the next propagation writes
     *  there can answer with that document's hash when the two are the same
     *  document — so the override re-stamped to it stays in sync through
     *  propagation instead of reading as a conflict. */
    snapshotHash?: (rel: string, content: JsonValue) => string;
  },
): string[] {
  const select = opts.select ?? (() => true);
  const snapshotHash =
    opts.snapshotHash ??
    ((_rel: string, content: JsonValue) => computeHash(content));
  const files = tree.paths().filter((f) => f.endsWith(".jsonc") && select(f));
  const next = new Map<string, string>();
  const rehash = new Map<string, string>();
  // Snapshots first: they produce the old → new hash pairs overrides follow.
  for (const f of [...files].sort(
    (a, b) => Number(isSnapshot(b)) - Number(isSnapshot(a)),
  )) {
    const text = tree.read(f);
    if (text === null)
      throw new Error(`config ledger: ${f} vanished mid-rewrite`);
    let out = opts.rewrite(f, text);
    const header = configTextHash(out);
    if (isSnapshot(f)) {
      if (out !== text && header !== undefined) {
        const hash = snapshotHash(f, parseConfigText(f, out));
        rehash.set(header, hash);
        out = withConfigTextHash(out, hash);
      }
    } else if (header !== undefined && rehash.has(header)) {
      const hash = rehash.get(header)!;
      out = withConfigTextHash(out, hash);
      // An automatic-merge record names the origin it merged onto twice: in
      // its header and as `toHash`, which its Undo is checked against.
      if (f.endsWith(MERGE_RECORD_SUFFIX)) {
        const record = parseConfigText(f, out);
        if (
          typeof record === "object" &&
          record !== null &&
          !Array.isArray(record) &&
          record.toHash === header
        )
          out = `// @hash ${hash}\n${JSON.stringify({ ...record, toHash: hash }, null, 2)}\n`;
      }
    }
    if (out !== text) next.set(f, out);
  }
  for (const [f, text] of next) tree.write(f, text);
  return [...next.keys()].sort();
}
