import type { JsonValue } from "./types";
import { assertMigrationKeys } from "./retired-fields";

/**
 * A one-time rewrite of a config's SAVED values, for when the shape its fields
 * store changed (a renamed key, a value re-spelled). The user layer
 * (`~/.equin/state/config/<ns>/`) is not in git, so a commit can only
 * change it through code the build runs: each `./equin build` applies
 * every migration its namespace has not applied yet — to that config's origin,
 * override and ancestor documents, base and app scopes — right before
 * propagating the git config there, and records it (the shared config ledger,
 * `config_v2/plugins/ledger`; hash chains are kept so overrides stay in
 * force). The committed `config/` files are rewritten in the same diff as the
 * code, by hand.
 *
 * `apply` receives one whole document and returns it rewritten (return it
 * unchanged when there is nothing to do). It must be idempotent: a document
 * already in the new shape is handed to it too.
 */
export interface ConfigMigration {
  /** Unique within its descriptor, and never reused: the ledger records it. */
  readonly id: string;
  apply(document: JsonValue): JsonValue;
  /**
   * The field keys this migration moves, old dotted key path → new one. A
   * field key the config no longer has must be declared somewhere —
   * `config-v2:fields-retired-declared` reads these (and `removes`, and the
   * descriptor's `retiredFields`) to know the key was not dropped by mistake.
   */
  readonly renames?: Readonly<Record<string, string>>;
  /** The field keys (dotted paths) this migration deletes from saved documents. */
  readonly removes?: readonly string[];
}

export function defineConfigMigration(
  migration: ConfigMigration,
): ConfigMigration {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(migration.id)) {
    throw new Error(
      `defineConfigMigration: id "${migration.id}" must be kebab-case (it is recorded in every namespace's ledger)`,
    );
  }
  assertMigrationKeys(migration);
  return Object.freeze(migration);
}
