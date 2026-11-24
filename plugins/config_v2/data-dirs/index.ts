import { defineDataDir } from "@plugins/infra/plugins/paths/core";

/**
 * The user layer of the three-layer config model: one `<namespace>/` subtree
 * per namespace, holding its config generations (`gens/<id>/` — each a whole
 * user layer: propagated `<name>.origin.jsonc` files, the user's own
 * `<name>.jsonc` overrides, `.ancestor.jsonc` conflict snapshots, merge
 * records) and the `HEAD` naming the one it serves (`config_v2/core`'s
 * generation layout). Read a namespace's served layer through
 * `config_v2/disk-read`'s `servedConfigDir`, never `.file(name)` alone.
 *
 * A worktree's subtree is forked from main's served generation on create (the
 * worktree workspace's `forkConfigDir`) and reaped with the worktree
 * (`debug/worktree-cleanup`).
 */
export const configDir = defineDataDir({
  kind: "state",
  name: "config",
  owner: "config_v2",
  description:
    "The user config layer: per-worktree propagated origins plus the user's own JSONC overrides and conflict ancestors",
  // The override files are the user's own edits — hand-written or made through
  // Settings — and exist nowhere else. Deleting them silently reverts every
  // customization to the committed defaults.
  reclaim: {
    kind: "never",
    reason:
      "the user's own config overrides live here and exist nowhere else; deleting them silently reverts every customization",
  },
});

export default [configDir];
