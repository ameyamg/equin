import { defineFoldCheck } from "@plugins/framework/plugins/tooling/plugins/checks/core";
import {
  migrationDataIn,
  MIGRATIONS_DATA_DIR,
  publishedMigrationBasenames,
  publishedMigrationRefsSignature,
  SNAPSHOT_SCAN_CONTEXT,
  schemaMigrationFilesIn,
  snapshotFactsFiles,
} from "@plugins/database/plugins/migrations/core";
// The runner's own planner validates the claims and adoptions with this, so
// this check cannot drift from what boot would refuse.
import {
  resolveMigrationRefs,
  type MigrationRefs,
} from "@plugins/database/plugins/migrations/plugins/phases/core";
import { isMigrationFileName } from "@plugins/database/plugins/migrations/server";
import { getWorktreeRoot } from "@plugins/infra/plugins/spawn/core";
import {
  migrationPhasesFold,
  type MigrationFileFacts,
  type PhaseFacts,
} from "./migration-phases-valid.scan";

const MIGRATION_RE = /^(\d{8})_(\d{6})_([0-9a-f]{8})__(.+)\.sql$/;

/** One migration file on disk, as the fold keeps it. `file` is the `.sql` basename. */
export interface MigrationFile {
  file: string;
  /** What its phase grammar says (`phaseFactsOf`). */
  facts: PhaseFacts;
  /** True when it is a schema migration (`isSchemaMigration`). */
  isSchema: boolean;
}

/**
 * PURE core (exported for unit testing): every reason a BRANCH-LOCAL schema
 * migration (absent from `tracked`, the published basenames) was not produced by the
 * current generator, as one line each.
 *
 * - It must be phased — a legacy one would apply its contract before the data
 *   it claims.
 * - Each of its statements must re-classify into the section it sits in: an
 *   expand statement as expand, a contract statement as contract. That is what
 *   the generator wrote, so a mismatch is a hand-edit or a stale file.
 *
 * - A merge node (a snapshot header with two or more parents) must be a no-op: empty sections,
 *   no claims and no supersedes. Its snapshot is a merge, not a diff, so any SQL
 *   in it would apply DDL no snapshot accounts for.
 *
 * And, over EVERY file (published too): an adoption file (an `adopts` header)
 * is not a schema migration and adopts only schema migrations (the runner's planner
 * checks each names an earlier phased file); a hash a `supersedes` header names must
 * not be a file on disk. A reset deletes what it supersedes; a superseded file
 * still present would run its DDL AND let the superseding file be adopted.
 *
 * Claims and adoptions are validated by the runner's own `resolveMigrationRefs`
 * in the verdict.
 */
export function findPhaseErrors(
  files: readonly MigrationFile[],
  tracked: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  for (const m of files) {
    if (!m.isSchema || tracked.has(m.file)) continue;
    const parsed = m.facts;
    if (parsed.kind === "error") {
      errors.push(`${m.file}: ${parsed.message}`);
      continue;
    }
    if (parsed.kind === "legacy") {
      errors.push(
        `${m.file}: a branch-local schema migration without phase markers`,
      );
      continue;
    }
    if (
      parsed.merge &&
      (!parsed.empty || parsed.claims.length > 0 || parsed.supersedes !== null)
    ) {
      errors.push(
        `${m.file}: a merge node must be a no-op (empty expand and contract, no claims, no supersedes)`,
      );
      continue;
    }
    for (const line of parsed.misclassified) errors.push(`${m.file}: ${line}`);
  }
  const fileByHash = new Map(
    files.map((m) => [MIGRATION_RE.exec(m.file)?.[3], m.file]),
  );
  const isSchemaByHash = new Map(
    files.map((m) => [MIGRATION_RE.exec(m.file)?.[3], m.isSchema]),
  );
  for (const m of files) {
    const parsed = m.facts;
    if (parsed.kind === "error") {
      // A branch-local schema file's parse error is already reported above.
      if (!m.isSchema || tracked.has(m.file))
        errors.push(`${m.file}: ${parsed.message}`);
      continue;
    }
    if (parsed.kind !== "phased" || parsed.supersedes === null) continue;
    if (parsed.adopts.length > 0) {
      if (m.isSchema)
        errors.push(
          `${m.file}: an adoption file is not a schema migration (no snapshot) — it records, it changes no schema`,
        );
      for (const h of parsed.adopts) {
        if (isSchemaByHash.get(h) === false)
          errors.push(
            `${m.file}: adopts ${fileByHash.get(h)}, which is not a schema migration`,
          );
      }
    }
    const lineage = [
      ...parsed.supersedes.direct,
      ...parsed.supersedes.inherited.flatMap((e) => [e.hash, ...e.replaced]),
    ];
    for (const h of new Set(lineage)) {
      const still = fileByHash.get(h);
      if (still !== undefined)
        errors.push(
          `${m.file}: supersedes ${h}, but ${still} is still on disk — a reset deletes what it supersedes`,
        );
    }
  }
  return errors;
}

/**
 * Every claim and adoption reference over `files` (in name order — the
 * runner's timestamp order) as the runner's planner validates them: null, or
 * the first one it refuses. Not asked while a file does not parse (that is
 * already an error, and the planner would refuse to plan at all).
 */
function findRefError(files: readonly MigrationFile[]): string | null {
  const entries: { file: string; hash: string; refs: MigrationRefs }[] = [];
  for (const { file, facts } of files) {
    if (facts.kind === "error") return null;
    entries.push({ file, hash: MIGRATION_RE.exec(file)![3]!, refs: facts });
  }
  try {
    resolveMigrationRefs(entries, (e) => e.refs);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** The data dir, as the folded heads hold it: what `schemaMigrationFilesIn` reads. */
async function schemaFilesOf(
  folded: readonly MigrationFileFacts[],
  under: (dir: string) => readonly string[],
): Promise<Set<string>> {
  const prefix = `${MIGRATIONS_DATA_DIR}/`;
  const heads = new Map(folded.map(([rel, head]) => [`${prefix}${rel}`, head]));
  return schemaMigrationFilesIn(
    migrationDataIn({
      under,
      read: (path) => Promise.resolve(heads.get(path) ?? null),
    }),
  );
}

// A fold check: each data-dir file's phase facts and snapshot head are its
// record (./migration-phases-valid.scan.ts), so the body reads no migration of
// its own — its cost no longer grows with the number of migrations.
const check = defineFoldCheck({
  id: "migration-phases-valid",
  // INPUT-KEYED: the verdict reads the working tree only through the fold —
  // the data dir's membership and each folded file's blob, both recorded by
  // the recording file set — so an edit outside the data dir replays the
  // verdict. The published set (git) is the signature below: the files on
  // every published ref, a function of the refs' commits alone.
  inputKeyed: true,
  description:
    "branch-local schema migrations are phased (expand / contract re-classify), and the runner's planner accepts every claim on disk",
  async cacheSignature(): Promise<string | null> {
    return publishedMigrationRefsSignature(await getWorktreeRoot());
  },
  context: () => SNAPSHOT_SCAN_CONTEXT,
  files: (repo) => snapshotFactsFiles(repo),
  facts: () => null,
  fold: migrationPhasesFold,
  async verdict(folded, _inputs, ctx) {
    const repo = await ctx.repo();
    const tracked = await publishedMigrationBasenames(repo.root);
    const schema = await schemaFilesOf(folded, (dir) => repo.under(dir));
    const files: MigrationFile[] = folded.flatMap(([rel, , facts]) =>
      facts !== null && isMigrationFileName(rel)
        ? [{ file: rel, facts, isSchema: schema.has(rel) }]
        : [],
    );
    const errors = findPhaseErrors(files, tracked);
    const refError = findRefError(files);
    if (refError !== null) errors.push(refError);
    if (errors.length === 0) return { ok: true };
    return {
      ok: false,
      message: `phased migration(s) the runner would refuse:\n${errors.map((e) => `  ${e}`).join("\n")}`,
      hint:
        "Schema migrations are generator output — never hand-edit one. Regenerate this branch's with\n" +
        "  ./equin build --reset-migration --migration-name <slug>\n" +
        "which re-phases it and re-claims the branch's data migrations. See\n" +
        "plugins/database/plugins/migrations/CLAUDE.md → 'Phased schema migrations'.",
    };
  },
});

export default check;
