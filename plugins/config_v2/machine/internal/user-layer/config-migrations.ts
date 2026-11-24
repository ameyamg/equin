import {
  APP_SCOPE_DIR,
  configTextHash,
  parseConfigText,
  type ConfigDescriptor,
} from "../../../core";
import {
  rewriteConfigFiles,
  runConfigLedger,
  type ConfigTree,
} from "./config-tree";

/** Per-namespace record of the config migrations already applied. */
export const APPLIED_CONFIG_MIGRATIONS_FILE = ".config-migrations-applied.json";

export interface AppliedConfigMigration {
  /** `<hierarchy path>/<config name>:<migration id>` — the ledger key. */
  key: string;
  /** Files the migration (or the hash re-stamp it caused) rewrote. */
  rewritten: string[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const migrationKey = (
  hierarchyPath: string,
  descriptor: ConfigDescriptor,
  id: string,
) => `${hierarchyPath}/${descriptor.name}:${id}`;

/** Whether the namespace has saved config at all (a fresh one records migrations without running them). */
const isFresh = (tree: ConfigTree) =>
  !tree.paths().some((f) => f.endsWith(".jsonc"));

/**
 * Apply every config migration (`defineConfigMigration`, declared on a
 * descriptor's `migrations`) that `tree` has not applied yet: each one rewrites that config's origin, override and ancestor
 * documents — base scope and every `@app/<id>` scope — through its `apply`,
 * with the hash chain kept (the shared config ledger). A namespace with no
 * saved config yet records them all without running.
 */
export function applyConfigMigrations(opts: {
  tree: ConfigTree;
  configs: readonly { hierarchyPath: string; descriptor: ConfigDescriptor }[];
}): AppliedConfigMigration[] {
  const { tree, configs } = opts;
  const fresh = isFresh(tree);
  const entries = configs.flatMap(({ hierarchyPath, descriptor }) => {
    const files = new RegExp(
      `^${escapeRe(hierarchyPath)}/(${escapeRe(APP_SCOPE_DIR)}/[^/]+/)?${escapeRe(descriptor.name)}(\\.origin|\\.ancestor)?\\.jsonc$`,
    );
    return (descriptor.migrations ?? []).map((migration) => ({
      key: migrationKey(hierarchyPath, descriptor, migration.id),
      apply: (t: ConfigTree): string[] =>
        rewriteConfigFiles(t, {
          select: (rel) => files.test(rel),
          rewrite: (rel, text) => {
            const before = parseConfigText(rel, text);
            const after = migration.apply(before);
            if (JSON.stringify(after) === JSON.stringify(before)) return text;
            const hash = configTextHash(text);
            return `${hash === undefined ? "" : `// @hash ${hash}\n`}${JSON.stringify(after, null, 2)}\n`;
          },
        }),
    }));
  });
  return runConfigLedger({
    tree,
    markerFile: APPLIED_CONFIG_MIGRATIONS_FILE,
    fresh,
    entries,
  }).map(({ key, result }) => ({ key, rewritten: result }));
}
