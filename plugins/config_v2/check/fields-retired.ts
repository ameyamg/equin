import type { FieldsRecord } from "@plugins/fields/core";
import {
  declaredRetiredPaths,
  parseConfigFile,
  undeclaredFieldPaths,
  type ConfigMigration,
  type RetiredFields,
} from "../core";
import type { ConfigRegistration } from "./config-registrations";

/** What the rule reads off a registered descriptor. */
interface RetirableDescriptor {
  fields: FieldsRecord;
  retiredFields?: RetiredFields;
  migrations?: readonly ConfigMigration[];
}

function isRetirable(d: unknown): d is RetirableDescriptor {
  return (
    typeof d === "object" &&
    d !== null &&
    "fields" in d &&
    typeof (d as { fields: unknown }).fields === "object"
  );
}

/** A field key the merge base's origin holds that the code no longer declares. */
export interface UndeclaredRemoval {
  /** The descriptor's storePath (`<plugin-tree>/<name>.jsonc`). */
  storePath: string;
  /** Dotted key path. */
  path: string;
}

/** The committed origin of a storePath, repo-relative. */
export function originRelPath(storePath: string): string {
  return `config/${storePath.replace(/\.jsonc$/, ".origin.jsonc")}`;
}

/**
 * The rule of `config-v2:fields-retired-declared`, pure: for every registered
 * descriptor whose origin existed at the merge base, every field key path that
 * origin holds which the current descriptor neither declares as a field nor as
 * retired (`retiredFields`, a migration's `renames` keys / `removes`).
 *
 * `originAt(storePath)` is the merge base's origin text, or `null` when there
 * was none (a new config, or a moved plugin — the move ledger's business).
 * Descriptors are judged once per storePath (several runtimes register one).
 */
export function undeclaredFieldRemovals(
  registrations: readonly ConfigRegistration[],
  originAt: ReadonlyMap<string, string>,
): UndeclaredRemoval[] {
  const out: UndeclaredRemoval[] = [];
  const seen = new Set<string>();
  for (const r of registrations) {
    if (seen.has(r.storePath)) continue;
    seen.add(r.storePath);
    if (!isRetirable(r.descriptor)) continue;
    const text = originAt.get(r.storePath);
    if (text === undefined) continue;
    const { content } = parseConfigFile(
      text,
      `${originRelPath(r.storePath)} at the merge base`,
    );
    if (
      typeof content !== "object" ||
      content === null ||
      Array.isArray(content)
    )
      continue;
    const declared = declaredRetiredPaths(r.descriptor);
    for (const path of undeclaredFieldPaths(content, r.descriptor.fields)) {
      if (!declared.has(path)) out.push({ storePath: r.storePath, path });
    }
  }
  return out.sort((a, b) =>
    a.storePath === b.storePath
      ? a.path.localeCompare(b.path)
      : a.storePath.localeCompare(b.storePath),
  );
}
