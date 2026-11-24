import { z } from "zod";
import { cappedList } from "@plugins/packages/plugins/list-bound/core";
import { sha256Hex } from "@plugins/packages/plugins/string-hash/core";
import type { PluginId } from "@plugins/framework/plugins/plugin-id/core";

// Config generations: a namespace's user layer, one directory per
// config-relevant code version.
//
//   <ns>/HEAD                  { generation, history } — the generation served
//   <ns>/.generation.lock      flock: derive → promote, and every write to HEAD's
//   <ns>/gens/<id>/…           a whole user layer (origins, overrides, ancestors,
//                              merge records, the applied-ledger markers)
//   <ns>/gens/<id>/.retired    written by the promote that moved HEAD past it
//
// The backend whose code reads a generation is the one that derives it, at its
// own boot, and moves HEAD once it serves. Design:
// research/2026-11-24-global-config-auto-merge.md § 5.

/** The directory holding a namespace's generations. */
export const CONFIG_GENS_DIR = "gens";
/** The file naming the generation a namespace serves. */
export const CONFIG_HEAD_FILE = "HEAD";
/** The flock serializing a derive with its promote, and a write with a promote. */
export const CONFIG_GENERATION_LOCK_FILE = ".generation.lock";
/** Inside a generation: present once HEAD moved past it. Writes to it are refused. */
export const CONFIG_GENERATION_RETIRED_FILE = ".retired";

/**
 * Every entry the generation machinery keeps at a namespace dir's root — what
 * a legacy (pre-generation) root's config files are told apart from.
 */
export const CONFIG_GENERATION_ROOT_ENTRIES: ReadonlySet<string> = new Set([
  CONFIG_GENS_DIR,
  CONFIG_HEAD_FILE,
  CONFIG_GENERATION_LOCK_FILE,
]);

/** How many earlier HEADs a namespace remembers — what tells a rollback from a leftover. */
export const CONFIG_HEAD_HISTORY_MAX = 50;

export const configHeadSchema = z.object({
  /** The generation served: its backend derived it and promoted it. */
  generation: z.string().min(1),
  /** Every generation that was HEAD, oldest first, this one last. */
  history: cappedList(z.string().min(1), { max: CONFIG_HEAD_HISTORY_MAX }),
});
export type ConfigHead = z.infer<typeof configHeadSchema>;

/** The HEAD after `generation` is promoted over `previous`. */
export function nextConfigHead(
  previous: ConfigHead | null,
  generation: string,
): ConfigHead {
  const earlier = (previous?.history ?? []).filter((g) => g !== generation);
  return {
    generation,
    history: [...earlier, generation].slice(-CONFIG_HEAD_HISTORY_MAX),
  };
}

/**
 * Bumped when what a generation id covers changes meaning — and when the
 * derive itself (`config_v2/machine/internal/user-layer/`, `propagate`) would
 * write a different user layer from the same inputs: a namespace re-derives
 * only when the id moves, so a derive fix reaches no existing generation
 * until this changes.
 */
const GENERATION_FORMAT = "config-generation-v1";

/**
 * One plugin-move ledger entry as a derive replays it onto a user layer: its
 * ledger key, the move, and whether the moved-away id is a plugin of the tree
 * again (its config-migration markers are then its own). Baked into the
 * generation module by codegen (`CONFIG_PLUGIN_MOVES`).
 */
export interface ConfigPluginMove {
  readonly key: string;
  readonly from: PluginId;
  readonly to: PluginId;
  readonly fromIsPlugin: boolean;
}

/**
 * A config generation's id: what the user layer a backend reads is derived
 * from, hashed — the committed `config/` tree (every `.jsonc`, by repo-relative
 * path and git blob id), the plugin-move ledger's blob id, every declared
 * config migration's key (`<hierarchy path>/<name>:<id>`) and the merge
 * engine. Two code versions with the same id derive the same user layer, so
 * they share one generation.
 */
export function configGenerationId(inputs: {
  committed: readonly (readonly [path: string, blobId: string])[];
  pluginMoves: string;
  migrationKeys: readonly string[];
  mergeEngine: string;
}): string {
  const parts: string[] = [GENERATION_FORMAT, inputs.mergeEngine];
  for (const [path, blob] of [...inputs.committed].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  ))
    parts.push(`file ${path} ${blob}`);
  parts.push(`moves ${inputs.pluginMoves}`);
  for (const key of [...inputs.migrationKeys].sort())
    parts.push(`migration ${key}`);
  return sha256Hex(parts.join("\n")).slice(0, 16);
}
