import {
  parseMigration,
  snapshotLineage,
  type Supersession,
} from "@plugins/database/plugins/migrations/plugins/phases/core";
import { classifyStatement } from "../core/internal/classify";
import { splitStatements } from "../core/internal/statements";
import {
  snapshotHeadsFold,
  type SnapshotScanContext,
} from "../core/internal/snapshot-heads.scan";

// migration-phases-valid's per-file work as a fold kept along the directory
// tree (`defineFoldCheck`): each data-dir file's record is its snapshot head
// (the migrations core's heads scan — what the schema-migration predicate
// reads) and, for a `.sql`, what its phase grammar says. So a cold store parses
// and classifies each migration once as shared record work, a pass after an
// edit only the edited ones, and the check's own body reads no migration (it
// made one read per migration, 474 on 2026-11-23 against the 1,000 a check may
// make undeclared).
//
// The scan imports the grammar (the phases leaf) and the statement table
// (`classify` / `statements`, leaves of this plugin's core) — never the core
// barrel, which would key every record on its ~80 modules.

/** What a migration's phase grammar says, without its SQL. */
export type PhaseFacts =
  | { kind: "error"; message: string }
  | { kind: "legacy" }
  | {
      kind: "phased";
      claims: string[];
      adopts: string[];
      supersedes: Supersession | null;
      /** Its snapshot header names two or more parents. */
      merge: boolean;
      /** Both sections hold no SQL. */
      empty: boolean;
      /** Each statement that does not re-classify into the section it sits in. */
      misclassified: string[];
    };

/** PURE: the phase facts of one migration's text. */
export function phaseFactsOf(sql: string): PhaseFacts {
  let parsed: ReturnType<typeof parseMigration>;
  try {
    parsed = parseMigration(sql);
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
  if (parsed.kind === "legacy") return { kind: "legacy" };
  const misclassified: string[] = [];
  for (const phase of ["expand", "contract"] as const) {
    for (const stmt of splitStatements(parsed[phase])) {
      const cls = classifyStatement(stmt);
      if (cls.kind !== phase) {
        const oneLine = stmt.raw.replace(/\s+/g, " ").slice(0, 120);
        misclassified.push(
          `${phase} statement classifies as ${cls.kind}${"op" in cls ? ` (${cls.op})` : ""}: ${oneLine}`,
        );
      }
    }
  }
  return {
    kind: "phased",
    claims: [...parsed.claims],
    adopts: [...parsed.adopts],
    supersedes: parsed.supersedes,
    merge: (snapshotLineage(sql)?.parents.length ?? 0) > 1,
    empty: parsed.expand === "" && parsed.contract === "",
    misclassified,
  };
}

/** One data-dir file: its path (data-dir-relative), its snapshot head, its phase facts (a `.sql` only). */
export type MigrationFileFacts = [
  rel: string,
  head: string,
  phases: PhaseFacts | null,
];

// A `FileFold<SnapshotScanContext, MigrationFileFacts[]>`, spelled
// structurally: plugin-records reaches the database (through its reports
// sub-plugin), so even a type import of `FileFold` here would close a plugin
// cycle. `defineFoldCheck` types it as one.
export const migrationPhasesFold = {
  url: import.meta.url,
  scan(
    src: string,
    repoRel: string,
    context: SnapshotScanContext,
  ): MigrationFileFacts[] {
    return snapshotHeadsFold
      .scan(src, repoRel, context)
      .map(([rel, head]): MigrationFileFacts => [
        rel,
        head,
        !rel.includes("/") && rel.endsWith(".sql") ? phaseFactsOf(src) : null,
      ]);
  },
  combine: (parts: readonly MigrationFileFacts[][]): MigrationFileFacts[] =>
    parts.flat(),
};
