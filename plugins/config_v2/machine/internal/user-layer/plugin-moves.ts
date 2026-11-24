// Replays the plugin-move ledger onto one namespace's USER-layer config, held
// in memory as a `ConfigTree`. Run by the backend deriving its config
// generation (config_v2#machine), right before it propagates the git config
// into it, so the generation is shaped like the code that reads it.
//
// A plugin's config lives under its id's slash path, and saved reorder layouts
// name contributions `"<pluginId>:<id>"` in ANY slot's file. A move changes
// both. For each entry this namespace has not applied yet:
//
//   1. every file under `<from path>/` moves to the same spot under `<to path>/`
//      — a file already at the destination wins and the source stays put (the
//      orphan audit then flags it). Nothing is overwritten or deleted.
//   2. every reorder key naming the moved plugin (or a descendant) is rewritten,
//      in every `.jsonc` of the namespace — found by the same reading the mover
//      and the plugin-refs locator use (`relocate/reroot`).
//   3. hash headers are kept consistent. An override records the hash of the
//      default it was written against; rewriting that default's keys changes
//      its hash, which would mark the override stale and let the default win —
//      the very loss this prevents. So every rewritten origin/ancestor yields an
//      old → new hash pair, and each override's header is re-stamped through it.
//      A rewritten ORIGIN is stamped with the hash of the document propagation
//      is about to write there (the checkout's git layer) when the two are the
//      same document but for order — a renamed key re-sorts in a regenerated
//      catalog, and the text's own hash would then disagree with propagation's
//      and turn the re-stamped override into a conflict anyway.
//
// Each applied entry is recorded in the namespace's marker file, so an entry is
// replayed once — even if a later plugin reuses the old id. A namespace with
// no saved config yet records every entry as applied: it has nothing to move.
// The ledger mechanics (marker, fresh namespace, hash re-stamping) are the
// shared config ledger's (`./config-tree.ts`), which config migrations ride
// too. The moves are the ledger as this code was built with it — codegen bakes
// it into the generation module (`CONFIG_PLUGIN_MOVES`), so a release backend
// has it too.

import { z } from "zod";
import { asPath } from "@plugins/framework/plugins/plugin-id/core";
import { rerootReorderKeys } from "@plugins/plugin-meta/plugins/relocate/plugins/reroot/core";
import {
  committedDocument,
  computeHash,
  parseConfigFileRelPath,
  sameDocumentModuloOrder,
  scopeAppId,
  type CommittedFiles,
  type ConfigPluginMove,
  type JsonValue,
} from "../../../core";
import { APPLIED_CONFIG_MIGRATIONS_FILE } from "./config-migrations";
import {
  rewriteConfigFiles,
  runConfigLedger,
  type ConfigTree,
} from "./config-tree";

/** Per-namespace record of the ledger entries already applied. Not `.jsonc`,
 *  so neither the config registry nor the orphan audit ever reads it. */
export const APPLIED_MOVES_FILE = ".plugin-moves-applied.json";

export interface AppliedMove {
  move: ConfigPluginMove;
  /** Files moved from the old slash path to the new one (dir-relative). */
  moved: string[];
  /** Files left at the old path because the destination already had one. */
  kept: string[];
  /** Files whose reorder keys or hash header were rewritten. */
  rewritten: string[];
}

/**
 * Every file of `tree` under `src/` moved to the same spot under `dst/` — a
 * file already at the destination wins and the source stays put.
 */
function moveTree(
  tree: ConfigTree,
  src: string,
  dst: string,
): { moved: string[]; kept: string[] } {
  const moved: string[] = [];
  const kept: string[] = [];
  for (const path of tree.paths()) {
    if (!path.startsWith(`${src}/`)) continue;
    const rel = path.slice(src.length + 1);
    const to = `${dst}/${rel}`;
    if (tree.read(to) !== null) {
      kept.push(rel);
      continue;
    }
    tree.write(to, tree.read(path)!);
    tree.remove(path);
    moved.push(rel);
  }
  return { moved, kept };
}

/**
 * The hash a re-rooted user snapshot is stamped with: for an origin that is the
 * git-layer document propagation writes next but for order, that document's
 * hash (what propagation will stamp); otherwise its own content's.
 */
function upstreamAwareHash(
  files: CommittedFiles,
): (rel: string, content: JsonValue) => string {
  return (rel, content) => {
    const ref = parseConfigFileRelPath(rel);
    if (ref.file !== "origin") return computeHash(content);
    const doc = committedDocument(ref.storePath, files);
    const appId = scopeAppId(ref.scopeId);
    const upstream =
      doc === undefined
        ? undefined
        : appId === undefined
          ? doc.base
          : doc.scopes[appId];
    return upstream !== undefined && sameDocumentModuloOrder(content, upstream)
      ? computeHash(upstream)
      : computeHash(content);
  };
}

/**
 * A config-migration marker key (`<hierarchy path>/<config name>:<migration
 * id>`, `applyConfigMigrations`) re-rooted through `moves`, in ledger order:
 * a key under a moved plugin's slash path names the same config at its new
 * path. Unchanged when no move covers it.
 */
export function rerootMigrationKey(
  key: string,
  moves: readonly Pick<ConfigPluginMove, "from" | "to">[],
): string {
  let out = key;
  for (const m of moves) {
    const from = `${asPath(m.from)}/`;
    if (out.startsWith(from)) out = `${asPath(m.to)}/${out.slice(from.length)}`;
  }
  return out;
}

const appliedMigrationsSchema = z.object({ applied: z.array(z.string()) });

/**
 * The config migrations a namespace applied are recorded by config path, so
 * they must follow a move with the files they rewrote — else the moved files
 * look un-migrated at their new path and the migration runs on them again.
 * Run on EVERY pass, not once per entry: it is idempotent (a re-rooted key is
 * under no moved path), so a namespace whose files moved before this existed
 * heals on its next build. Only moves whose old directory is not a plugin
 * again count — a reused id's markers are its own. Returns the re-rooted keys.
 */
function rerootMigrationMarkers(
  tree: ConfigTree,
  moves: readonly ConfigPluginMove[],
): string[] {
  const text = tree.read(APPLIED_CONFIG_MIGRATIONS_FILE);
  if (text === null) return [];
  const gone = moves.filter((m) => !m.fromIsPlugin);
  const { applied } = appliedMigrationsSchema.parse(JSON.parse(text));
  const rerooted = applied.filter((k) => rerootMigrationKey(k, gone) !== k);
  if (rerooted.length === 0) return [];
  const next = [...new Set(applied.map((k) => rerootMigrationKey(k, gone)))];
  tree.write(
    APPLIED_CONFIG_MIGRATIONS_FILE,
    `${JSON.stringify({ applied: next }, null, 2)}\n`,
  );
  return rerooted;
}

/**
 * Apply every entry of `moves` (the committed ledger, in order) that the
 * namespace's user layer `tree` has not applied yet. A `fresh` namespace
 * (nothing saved yet) records every entry without moving anything.
 * `committed` is the committed layer propagation writes next. Throws on
 * anything unreadable.
 */
export function applyPluginMoves(opts: {
  tree: ConfigTree;
  moves: readonly ConfigPluginMove[];
  committed: CommittedFiles;
  fresh: boolean;
}): AppliedMove[] {
  const { tree, moves, committed } = opts;
  const applied = runConfigLedger({
    tree,
    markerFile: APPLIED_MOVES_FILE,
    fresh: opts.fresh,
    entries: moves.map((move) => ({
      key: move.key,
      apply: (t): AppliedMove => {
        const { moved, kept } = moveTree(t, asPath(move.from), asPath(move.to));
        const rewritten = rewriteConfigFiles(t, {
          rewrite: (f, text) => rerootReorderKeys(f, text, move),
          snapshotHash: upstreamAwareHash(committed),
        });
        return { move, moved, kept, rewritten };
      },
    })),
  }).map(({ result }) => result);
  // After the files moved: the migrations they carry follow them.
  rerootMigrationMarkers(tree, moves);
  return applied;
}
