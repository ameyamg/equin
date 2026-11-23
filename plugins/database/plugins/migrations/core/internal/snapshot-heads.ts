import { MIGRATIONS_DATA_DIR } from "./published";
import { LEGACY_SNAPSHOTS_FILE, SNAPSHOT_HEAD_BYTES } from "./schema-snapshot";
import { isSnapshotFactsFile } from "./snapshot-dag";
import type { SnapshotScanContext } from "./snapshot-heads.scan";

/** The data dir's layout, handed to the import-free heads scan as its context. */
export const SNAPSHOT_SCAN_CONTEXT: SnapshotScanContext = {
  dataDir: MIGRATIONS_DATA_DIR,
  wholeFile: `meta/${LEGACY_SNAPSHOTS_FILE}`,
  headChars: SNAPSHOT_HEAD_BYTES,
};

/**
 * The data-dir files the heads fold reads (repo-relative), chosen from a file
 * set's paths alone: what `isSnapshotFactsFile` names.
 */
export function snapshotFactsFiles(repo: {
  under(dir: string): readonly string[];
}): string[] {
  const prefix = `${MIGRATIONS_DATA_DIR}/`;
  return repo
    .under(MIGRATIONS_DATA_DIR)
    .filter((p) => isSnapshotFactsFile(p.slice(prefix.length)));
}
