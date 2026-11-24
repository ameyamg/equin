# Config updates: automatic merge of the user layer, and config owned by the backend that reads it

Task: task-1795524794-221nve. Status: phases 1 (merge engine), 2 (record, boot auto-merge, Undo, notification — `config_v2/plugins/auto-merge`) and 3 (developer review: per-field Keep / Use mine / Use new default, nav view, notice) implemented; phases 4–6 planned.

## Context

When an update ships new defaults for a config the user customized, the user's
override goes stale (`// @hash` mismatch) and **the new defaults win until the
user clicks Keep / Accept / Merge** in Settings → Config. For other users of
equin this is a bad experience: an update silently undoes their settings. On
main today, `tasks/automations/deps-upgrades` is stale, which means the user's
Dependency upgrades automation is currently **off**.

The manual flow was kept because auto-resolution felt risky. Two things have
been measured since:

- **The history replay** (`$EQUIN_SCRATCH/audit.ts`, `eval.ts`, `eval.json`).
  The corpus is the 327 committed-override restamps in `config/**` history
  where both sides changed, each scored against what was actually committed.

  | Merge | Exact | Same content, other order | Content differs | Unresolved |
  |---|---|---|---|---|
  | today's `threeWayMerge` (top-level keys) | — | — | — | 288 |
  | deep v1 | 128 | 168 | 31 | 32 |
  | **deep v2** (below) | 151 | 145 | 31 | **0** |
  | Sonnet with field docs | 169 | 117 | 37 | 4 failed |

  Sonnet undid user deletions, dropped items the update added, and brought back
  removed ones in 18 cases v2 got right. Its one advantage is item placement.
  So: **v2 decides content, Sonnet only re-places new items**, and its answer
  is checked to be a permutation.
- **A bug in today's Merge.** `mergeConflictNow` (`registry.ts:1111`) and
  `computeDescriptorConflict` (`resource.ts:334`) merge the raw override. A
  partial override like `{ "enabled": true }` makes every other key look
  deleted: a false conflict on `prompt`, and the merged file drops 10 keys.

A second, separate defect was found in the deploy ordering. `deployNamespace`
(`plugins/framework/plugins/cli/plugins/build/cli/internal/deploy-namespace.ts`
L737-775) rewrites the user config dir (plugin moves, migrations, origins)
**before** the new backend serves. Two consequences:

- The old backend's watcher reads new-shape files. Migrated shapes fail its old
  schema, which shows an invalid banner and falls back to defaults.
- A failed deploy reverts the web bundle but never the config.

Auto-merge would make both worse, and it must be validated against the schema of
the code that will read the result.

Scope: **user layer only.** Agents' merges of committed `config/**` stay manual
(`config-origins-in-sync`).

## Design

### 1. Merge engine: `config_v2/core/internal/merge/` (pure, no I/O)

`mergeConfigDocument({ descriptor, base, yours, theirs })` returns
`{ status: "merged" | "conflict", document, decisions: FieldDecision[], reasons?, issues? }`.

- **Completion first.** `yours` is `normalize(base ⊕ override)`, the same
  normalization on all three sides (`diffNormalForm`, `normalizeCollectionItems`),
  so seeded `auto-` row ids don't turn every row into a delete plus an add.
  This is the partial-override bug fix.
- **Recursion.**
  - Objects are merged per key.
  - Lists are merged per row when every row has a unique key (precedence
    `id` > `item` > `label` > the string itself).
  - A list that can't be keyed is a conflict (`unkeyed-list`).
- **Order.**
  - In a reorder tree (`.items`), the user's order wins.
  - Elsewhere, both sides reordering differently is a conflict.
  - A new item goes after its neighbour from the side that added it.
- **Both sides changed the same scalar.** The user's value wins, and the decision
  is listed (`yours-won`).
- **Keys the user changed that are gone from `descriptor.fields`.**
  - If `retiredFields[k].renamedTo` is set, the value is carried to the new key
    (`removed-renamed`).
  - Otherwise the key is dropped and listed (`removed-dropped`, "X was removed,
    your value Y no longer applies").
- **Schema gate.** `descriptor.schema.safeParse(merged)` must pass, otherwise the
  result is `conflict` with `issues` and nothing is written.
- **Shared algorithm.** `threeWayMerge` becomes a wrapper, so the Settings Merge
  button, `trueConflictKeys` and auto-merge all use the same code.
- **App scopes.** `propagateGitLayerDocument` (`core/internal/git-layer.ts:216`)
  also passes the ancestor proxy for `@app/<id>` scopes, which today never get a
  merge base.

### 2. Merge record and Undo: `<name>.merge.jsonc`

- **Store integration.**
  - It is a 4th `ConfigDocumentFile` kind (`core/internal/store.ts`: union,
    `FILE_SUFFIX`, `SUFFIX_ORDER`, the parser).
  - The file store's watch and agent-ledger capture, the memory store, the orphan
    roles, and migration rewrites (`config_v2/plugins/ledger`) all cover it.
  - It is **not** in `documentStamp`, which keeps the conflict fingerprint at the
    three files it uses today.
- **Contents.**
  `{ version, id, mergedAt, engine, fromHash, toHash, inputs{base,yours,theirs}, undo{override, overrideHash, ancestor}, decisions, placement{status,…}, resolutions, acknowledgedAt?, notifiedAt? }`.
- **Apply.** One `editEntry("auto-merge")` writes the record, then the merged
  override under the new hash, then removes the ancestor.
- **Undo.** Restores the exact pre-merge override and ancestor, which turns it
  back into a normal conflict, and deletes the record. Undo is refused once the
  origin has moved on past `toHash` (the record shows as superseded).
- **Per field: Use mine / Use new default.**
  - The action rewrites that path and runs the schema check again.
  - It is refused if the user edited the field since the merge ("edited since").
- **Other writes.**
  - Reset / `deleteOverride` removes the record.
  - Acknowledging sets `acknowledgedAt`.
  - There is one record per document; a later merge replaces it.

### 3. Sub-plugin `config_v2/plugins/auto-merge`

It owns everything except the engine and the registry write paths. config_v2
never names it. Its pieces:

- **Registry helpers** in `config_v2/server`: `undoMerge`, `resolveMergeField`
  and `ackMerge`, which go through `withDocument` → `editEntry` →
  `refreshEntryNow`.
- **Live values.**
  - `config-v2.auto-merges`: no parameters; `serveValue` with
    `source: "external"`, memoized on the stat of each `.merge` file, the same
    pattern as conflict-locations.
  - `config-v2.auto-merge`: keyed `{ path, scopeId? }`, the full record plus
    which fields were edited since the merge. It is notified through
    `notifyDocument`.
- **Endpoints:** `POST /api/config-v2/auto-merge/{undo,resolve-field,ack}`.
- **Developer UI (`ForAudience developer`).**
  - An authored `auto-merged` view in `config/config_v2/settings/config_v2.settings.nav.jsonc`,
    filtered on a new nav field `autoMerged`. The nav's readiness waits for the
    new live value.
  - A `ConfigNavSlots.Notice` "N configs auto-merged in the last update".
  - A new `ConfigDetailSlots.Banner` slot, outside `ControlPanelPane`, for the
    review: a DataView of notable decisions. Columns: path, base, yours, new,
    result, outcome. Row actions: Keep, Use mine, Use new default. Header
    actions: Undo merge, Mark reviewed.
- **Non-developers.** A one-line banner, "Updated with the new defaults; your
  changes kept · N notes · Undo", which lists removed fields.
- **Notification.** One per propagation batch, from the propagation path or the
  boot sweep, deduplicated by record ids.
  - It uses `recordNotification` in category `updates`.
  - Action kind `config-auto-merge`: Undo all for users, Review for developers.
  - It is settled in place once everything is reviewed or undone, following the
    upstream reminder's precedent.
- **Placement job `config-auto-merge.place`** (`machine/`, `defineJob`).
  - **When:** enqueued only when the merge placed new items.
  - **Skips quietly:** with no Claude account (availability status),
    `heldAtClaudeLimit` on a usage limit, or when the record has been superseded
    or undone.
  - **The call:** `runClaudePrint` on Sonnet with base, yours, new and v2's list
    plus the field-doc comments, asking for only an array of keys.
  - **Accepted** only if the answer is a permutation of v2's keys and keeps the
    user's relative order. It is written only if the override still equals the
    merged result at that path. Otherwise the job records `rejected` and v2's
    order stands.
  - **Content is never touched by the model.**

### 4. Removed or renamed fields: the `fields-retired-declared` check

- **New declarations.**
  - Descriptor option `retiredFields?: Record<string, { renamedTo?: string; reason: string }>`.
  - `defineConfigMigration` gains optional `renames` / `removes`, so a migration
    says which keys it moves.
- **The check.**
  - It fails when a field key path that exists at `git merge-base HEAD main` (its
    committed `*.origin.jsonc`, read with `git show`) is missing from the current
    descriptor and is declared neither as retired nor in a migration's
    `renames` / `removes`.
  - Model: `published-migrations-immutable`. It is not `inputKeyed`, and the
    merge-base sha is part of its cache signature.
- **Effect.** A rename without a migration can no longer land, so user values are
  never stranded under an old key.

### 5. Config generations: the backend that reads config derives it

This fixes the deploy-ordering defect and gives the merge the schema of the code
that will read it. Running propagation inside the new backend against the same
directory is not enough:

- During a hot restart the old backend still serves and watches until the
  gateway switches over to the new one.
- Adopt skips startup altogether.
- A failed deploy would still leave the files written.

So config gets a **generation per config-relevant code version**:

- **Generation id.** Codegen emits `CONFIG_GENERATION` (in
  `plugins/config_v2/core/config-generation.generated.ts`). It is a hash of the
  committed `config/` tree, the plugin-move ledger, the descriptors' migration
  ids, and the merge-engine version. `config-origins-in-sync` keeps it in sync.
  - Because the id is imported by `config_v2/machine`, it is part of the
    backend's code closure. Any config change therefore forces a restart
    instead of an adopt, and restart-skip needs no change.
- **Layout.** `~/.equin/state/config/<ns>/gens/<id>/…` holds the full file set and
  the applied-ledgers. `<ns>/HEAD` names the current generation (written by
  atomic rename); `<ns>/.lock` is a flock.
  - `CONFIG_DIR` (`machine/internal/config-dir.ts`) is `gens/<CONFIG_GENERATION>`
    for the process's lifetime.
  - Most deploys don't change config: the old and new backend share the same
    generation, as today.
- **Derive (serve mode only, before ready).** A new `ConfigStore.open()` is called
  first in `initRegistry`. If its own generation is missing (or present but not
  HEAD), it:
  1. takes `.lock`;
  2. clones `gens/<HEAD>` (or the legacy root) to a temporary dir with `cp -c`;
  3. records the overrides' `(inode, mtime, size)`;
  4. runs `applyPluginMoves`, then `applyConfigMigrations` with the **live**
     `ConfigV2.Register` descriptors, then `propagateUserLayer` (the body of
     `propagateConfigToUser` moved into config_v2 as a pure function, with no
     barrels and no `discoverConfigs`), then the auto-merge;
  5. renames the temporary dir into place.
- **Promote (after `markServerReady`, in machine `onReady`).** Under `.lock`, it
  re-derives every override the old backend wrote during the overlap (its stat
  moved since the clone), then moves `HEAD`.
- **Fence.** A write from a retired generation (HEAD moved past it) throws
  `ConfigGenerationRetired`. A write therefore either lands before the switch
  and is carried over, or is refused loudly. It is never lost silently.
- **GC.** Keep HEAD, its predecessor, and generations pinned by a live
  main-slot lease.
- **The other paths.**

  | Path | What happens |
  |---|---|
  | Failed deploy | HEAD never moves, so the old generation is untouched. A leftover generation is derived again on the next attempt. |
  | Exec children | Read only. If their generation is missing, they fail loudly. |
  | Composition reset | `rm <ns>`; the next boot derives from scratch. Spawning `./equin config-propagate` is no longer needed. |
  | Worktree fork | Copies main's `gens/<HEAD>` plus `HEAD`. |
  | Release launcher | `propagateOriginLayer` is deleted; the deployed backend derives, and gains the migrations and moves it never ran. |
  | `readEffectiveConfigFromDisk` callers (build-targets, converge, main-slots, closure-guards) | Read `configDir.served(ns)`, which is `<ns>/gens/<HEAD>`. |
  | Rollback to older code | Reuses its own generation if one exists and files a report that writes made since were not carried over. With none, it fails loudly, because migrations can't be undone. |
- **Build.** The `applyPluginMoves` and `propagateConfig` spans are removed from
  `deployNamespace`; the build only regenerates origins and `CONFIG_GENERATION`.
- **Migration from today.** With no `HEAD`, the current flat dir is the source
  generation. Pre-generation code keeps using the root harmlessly. A later check
  removes the root once nothing runs old code.

## Delivery phases (each ships value; push in order)

1. **Engine and bug fix.** `mergeConfigDocument`, `threeWayMerge` as a wrapper,
   completion in `mergeConflictNow` / `computeDescriptorConflict`, the ancestor
   for scopes, and the corpus test. The Merge button goes from resolving 39 of
   the 327 history cases to all 327.
2. **Record, auto-apply, Undo notification.** For now, the registry auto-merges at
   startup every stale override that has an ancestor, against its live schema,
   until phase 5 lands. Normal users stop seeing conflicts.
3. **Developer review list** (nav view, banner slot, per-field actions).
4. **Removed and renamed fields**: `retiredFields`, `renames` / `removes` on
   migrations, the merge outcomes that use them, and the check.
5. **Config generations** (section 5).
6. **Sonnet placement job.**

Phase 2's startup auto-merge already uses the schema of the code that reads the
config. Phase 5 then closes the window in which the old backend reads files
written for the new code.

### Phase 3 as built (deviations)

- The review works per **top-level field** (`mergeReviewFields`): a field's
  deeper choices (list rows, object keys) are listed as notes under it, and
  Use mine / Use new default rewrite the whole field. Deep-path actions need a
  row-key path resolver over seeded ids; not needed yet.
- The `auto-merged` nav view is authored config, so it shows for every user
  (a DataView view has no audience); it lists configs only. The review, the
  per-field actions and the nav notice are developer-only.
- The nav field is a generic `ConfigNavSlots.Field` (settings never names
  auto-merge).
- Still open: the notification's developer action (Review instead of Undo
  all) and settling it in place once everything is reviewed.

## Critical files

- `plugins/config_v2/core/internal/{tier-logic,git-layer,store,collections}.ts` and a new `merge/`
- `plugins/config_v2/server/internal/{registry,resource,document-stamp}.ts`
- `plugins/config_v2/machine/internal/{file-store,config-dir,config-watcher}.ts` and a new `generation.ts`
- `plugins/config_v2/core/internal/{define-config,config-migration,types}.ts` (`retiredFields`, `renames` / `removes`)
- `plugins/config_v2/plugins/settings/web/{components/config-nav.tsx,components/config-detail.tsx,slots.ts}`
- `plugins/framework/plugins/tooling/plugins/codegen/core/config-origin-gen.ts` (split out `propagateUserLayer`, emit `CONFIG_GENERATION`)
- `plugins/framework/plugins/cli/plugins/build/cli/internal/deploy-namespace.ts`
- `plugins/conversations/plugins/workspace/plugins/worktree/server/internal/worktree-workspace.ts`, `plugins/infra/plugins/launcher/server/internal/config-propagate.ts`, the `config_v2/plugins/disk-read` callers
- New: `plugins/config_v2/plugins/auto-merge/{core,server,machine,web}`

Reuse: `validationIssues`, `normalizeCollectionItems` / `mapConfigLists`,
`editEntry` / `withDocument` / `refreshEntryNow` / `notifyDocument`,
conflict-locations' stat memo, `recordNotification` + `Notifications.Action`,
`ForAudience`, `runClaudePrint` + `heldAtClaudeLimit` + the availability status,
`applyPluginMoves`, `applyConfigMigrations`,
`published-migrations-immutable`'s merge-base reading.

## Verification

- **Engine unit tests** (`merge/merge-document.test.ts`):
  - partial override `{enabled:true}`;
  - scalar both changed;
  - a deletion by the user is respected;
  - removed field dropped and listed;
  - rename via `retiredFields`;
  - schema failure becomes a conflict;
  - unkeyed list;
  - `label` keys;
  - user order wins in `.items`;
  - a new item placed after its neighbour.
- **Corpus regression** (`merge/__tests__/corpus/`, built from `git.json`). Use the
  31 content cases, about 60 order cases and a few exact ones (about 600 KB).
  Assert:
  - no case is left unresolved;
  - no duplicate keys;
  - no deleted item is brought back;
  - the counts stay at or above 151 exact / 145 order-only.
- **Registry tests** (`registry.test.ts`, memory store): auto-merge apply, undo,
  superseded, resolve-field, edited since; `documentStamp` ignores `.merge`.
- **Generation tests.**
  - Unit: derive, promote, fence, failed-deploy-leaves-HEAD.
  - End to end: build a worktree with a config change. Confirm main's backend
    never saw new-shape files (its generation dir is unchanged), and that the
    worktree's `gens/<id>` was derived at boot.
- **Placement job**: a stub `runClaudePrint` that returns a valid answer, a
  non-permutation answer, and a usage limit.
- **Check fixtures**: a field renamed with and without a migration or a
  `retiredFields` entry.
- **By hand.**
  - On a worktree build, reproduce the two live conflicts (`deps-upgrades`,
    `task-deps-tree`). They should auto-merge to `enabled: true` + the new
    `prompt`, and the user's columns minus `presentation`.
  - The developer review list shows them; Undo brings back the conflict banner;
    `register_before_after` on `/settings;view.config_v2.settings.nav=auto-merged`.
- Re-run `$EQUIN_SCRATCH/eval.ts` on any change to the merge engine.
