import type { FieldsRecord } from "@plugins/fields/core";
import { isObjectFieldDef } from "@plugins/fields/plugins/object/plugins/config/core";
import type { ConfigMigration } from "./config-migration";

/**
 * A field key a config no longer has, declared on its descriptor
 * (`defineConfig({ retiredFields })`), keyed by its dotted key path (`prompt`,
 * `limits.maxRuns` — through `objectField` sub-fields only).
 *
 * - `renamedTo`: the dotted path of the CURRENT field that holds the same
 *   setting. An automatic merge carries a value the user changed under the old
 *   key over to it (`removed-renamed`).
 * - neither: the setting is gone. A merge drops the user's value and says so
 *   (`removed-dropped`, with `reason`).
 *
 * Why declared: a config's schema is `.passthrough()`, so a saved value under
 * a key the code no longer reads is never flagged — the new key backfills its
 * default and the setting silently reverts. `config-v2:fields-retired-declared`
 * fails a branch that drops a field key without this declaration or a
 * migration naming it (`renames` / `removes`).
 */
export interface RetiredField {
  readonly renamedTo?: string;
  readonly reason: string;
}

export type RetiredFields = Readonly<Record<string, RetiredField>>;

const PATH_RE = /^[^.]+(\.[^.]+)*$/;

/** Whether `path` (dotted) names a field of `fields` — through object sub-fields. */
export function fieldPathExists(fields: FieldsRecord, path: string): boolean {
  let level: FieldsRecord = fields;
  const parts = path.split(".");
  for (let i = 0; i < parts.length; i++) {
    const field = level[parts[i]!];
    if (field === undefined) return false;
    if (i === parts.length - 1) return true;
    if (!isObjectFieldDef(field)) return false;
    level = field.subFields;
  }
  return false;
}

/**
 * The field key paths `document` (a config document, e.g. an origin) holds
 * that `fields` does not declare: a top-level key with no field, or a key of
 * an `objectField`'s value with no sub-field. Only object sub-fields are
 * walked — a list's rows and a field whose value is free-form are data, not
 * field keys.
 */
export function undeclaredFieldPaths(
  document: Record<string, unknown>,
  fields: FieldsRecord,
): string[] {
  const out: string[] = [];
  const walk = (
    value: Record<string, unknown>,
    level: FieldsRecord,
    prefix: string,
  ) => {
    for (const [key, v] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const field = level[key];
      if (field === undefined) {
        out.push(path);
        continue;
      }
      if (
        isObjectFieldDef(field) &&
        typeof v === "object" &&
        v !== null &&
        !Array.isArray(v)
      ) {
        walk(v as Record<string, unknown>, field.subFields, path);
      }
    }
  };
  walk(document, fields, "");
  return out;
}

/**
 * Every key path a descriptor declares as no longer a field: its
 * `retiredFields`, and the old keys its migrations name (`renames` keys,
 * `removes`). What `config-v2:fields-retired-declared` accepts as declared.
 */
export function declaredRetiredPaths(descriptor: {
  readonly retiredFields?: RetiredFields;
  readonly migrations?: readonly ConfigMigration[];
}): Set<string> {
  const out = new Set(Object.keys(descriptor.retiredFields ?? {}));
  for (const m of descriptor.migrations ?? []) {
    for (const from of Object.keys(m.renames ?? {})) out.add(from);
    for (const removed of m.removes ?? []) out.add(removed);
  }
  return out;
}

/**
 * Validate a descriptor's `retiredFields` against its fields, at declaration:
 * a retired path must not be a current field (it would be both), and a
 * `renamedTo` must be one (a rename onto nothing carries the value nowhere).
 */
export function assertRetiredFields(
  name: string,
  fields: FieldsRecord,
  retired: RetiredFields,
): void {
  for (const [path, decl] of Object.entries(retired)) {
    if (!PATH_RE.test(path)) {
      throw new Error(
        `defineConfig: "${name}" retires "${path}", which is not a dotted key path.`,
      );
    }
    if (fieldPathExists(fields, path)) {
      throw new Error(
        `defineConfig: "${name}" retires "${path}", but still declares that field.`,
      );
    }
    if (decl.reason.trim() === "") {
      throw new Error(
        `defineConfig: "${name}" retires "${path}" with an empty reason — say why it went (it is shown to the user whose value it drops).`,
      );
    }
    if (
      decl.renamedTo !== undefined &&
      !fieldPathExists(fields, decl.renamedTo)
    ) {
      throw new Error(
        `defineConfig: "${name}" renames "${path}" to "${decl.renamedTo}", which is not one of its fields.`,
      );
    }
  }
}

/** A migration's `renames` / `removes`: dotted key paths. */
export function assertMigrationKeys(migration: ConfigMigration): void {
  const paths = [
    ...Object.entries(migration.renames ?? {}).flat(),
    ...(migration.removes ?? []),
  ];
  for (const p of paths) {
    if (!PATH_RE.test(p)) {
      throw new Error(
        `defineConfigMigration: "${migration.id}" names "${p}", which is not a dotted key path.`,
      );
    }
  }
}
