export {
  migrationClaimId,
  parseMigration,
  renderAdoptionMigration,
  renderMergeSnapshotMigration,
  renderPhasedMigration,
  renderSnapshotHeader,
  snapshotLineage,
} from "./internal/phases";
// Every claim and adoption over a migration set, validated: the runner's
// planner and the migration-phases-valid check share it.
export { resolveMigrationRefs } from "./internal/refs";
export type { MigrationRefs } from "./internal/refs";
export type {
  ParsedMigration,
  PhasedMigration,
  SnapshotLineage,
  Supersession,
} from "./internal/phases";
