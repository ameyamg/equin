import { migrationClaimId } from "./phases";

/**
 * What the claim and adoption rules read of one migration file: whether it is
 * phased, and the files its header names. A `ParsedMigration` is one; so are
 * the facts a check keeps of a file without its SQL.
 */
export type MigrationRefs =
  | { kind: "legacy" }
  | {
      kind: "phased";
      claims: readonly string[];
      adopts: readonly string[];
      /** An adoption file always has one; `adopts` is read only when it is set. */
      supersedes: unknown;
    };

/**
 * Every claim and adoption over `migrations` — every file on disk, in the
 * order the runner applies them, each with its filename hash — resolved and
 * validated. Returns each claimed file's claimer. THROWS on the first
 * reference the runner refuses, since each would apply a contract before the
 * data it was written to follow, or adopt what cannot be adopted:
 *
 * - two files sharing a claim id (timestamp + slug);
 * - a claim naming no file, a phased schema migration, a file sorting at or
 *   after its claimer, or a file another file already claims;
 * - an adoption naming no file's hash, a file that is not a phased schema
 *   migration (or is itself an adoption file), or one sorting at or after the
 *   adoption file.
 *
 * The runner's planner (`planSchemaSteps`) and the migration-phases-valid
 * check both call it, so a check cannot accept what boot would refuse.
 */
export function resolveMigrationRefs<M extends { file: string; hash: string }>(
  migrations: readonly M[],
  refsOf: (m: M) => MigrationRefs,
): Map<M, M> {
  const byClaimId = new Map<string, { m: M; index: number }>();
  for (const [index, m] of migrations.entries()) {
    const id = migrationClaimId(m.file);
    const prior = byClaimId.get(id);
    if (prior) {
      throw new Error(
        `migrations ${prior.m.file} and ${m.file} share the claim id "${id}" (same timestamp and slug) — a claim could not tell them apart.`,
      );
    }
    byClaimId.set(id, { m, index });
  }

  const claimer = new Map<M, M>();
  for (const [index, s] of migrations.entries()) {
    const p = refsOf(s);
    if (p.kind !== "phased") continue;
    for (const id of p.claims) {
      const target = byClaimId.get(id);
      if (!target) {
        throw new Error(
          `migration ${s.file} claims "${id}", but no migration file has that timestamp and slug.`,
        );
      }
      if (refsOf(target.m).kind === "phased") {
        throw new Error(
          `migration ${s.file} claims ${target.m.file}, which is a phased schema migration — only data migrations can be claimed.`,
        );
      }
      if (target.index >= index) {
        throw new Error(
          `migration ${s.file} claims ${target.m.file}, which sorts after it — a claimed data migration must sort before its claimer.`,
        );
      }
      const prior = claimer.get(target.m);
      if (prior) {
        throw new Error(
          `migration ${target.m.file} is claimed by both ${prior.file} and ${s.file}.`,
        );
      }
      claimer.set(target.m, s);
    }
  }

  const byHash = new Map(migrations.map((m, index) => [m.hash, { m, index }]));
  for (const [index, m] of migrations.entries()) {
    const p = refsOf(m);
    if (p.kind !== "phased" || p.supersedes === null) continue;
    for (const h of p.adopts) {
      const target = byHash.get(h);
      if (!target) {
        throw new Error(
          `migration ${m.file} adopts ${h}, but no migration file has that hash.`,
        );
      }
      const t = refsOf(target.m);
      if (t.kind !== "phased" || t.adopts.length > 0) {
        throw new Error(
          `migration ${m.file} adopts ${target.m.file}, which is not a phased schema migration — only one can be adopted.`,
        );
      }
      if (target.index >= index) {
        throw new Error(
          `migration ${m.file} adopts ${target.m.file}, which sorts after it — an adopted migration must sort before its adoption file.`,
        );
      }
    }
  }
  return claimer;
}
