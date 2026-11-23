// Each data-dir file's snapshot-bearing bytes, as a fold kept along the
// directory tree (`plugin-records`' `FileFold`): a `.sql`'s first line (its
// snapshot header), a snapshot JSON's head, `legacy-snapshots.json` whole. The
// checks that read the snapshot lineage (snapshot-chain-intact,
// migration-metadata-consistent) fold the data dir through it, so a cold store
// reads each file once as shared record work and a pass after an edit reads
// only the edited files — never one read per migration in a check's own body
// (snapshot-chain-intact: 1,017 on a fresh clone, over the 1,000 a check may
// make undeclared).
//
// The scan keeps bytes, not facts: the parsing is `snapshotFactsOf`, run by
// the verdict over these heads, and importing it here would key every record
// on what it imports. So this module imports nothing, and
// what it must know of the layout comes in through the context (part of every
// record's key) — `SNAPSHOT_SCAN_CONTEXT` (`./snapshot-heads`).

/** The data dir's layout, as the scan reads it. */
export type SnapshotScanContext = {
  /** The data dir, repo-relative (no trailing slash). */
  dataDir: string;
  /** The data-dir-relative path of the file kept whole (the legacy lineage). */
  wholeFile: string;
  /** How much of a snapshot JSON file's start holds its head. */
  headChars: number;
};

/** Each file's head, `[data-dir-relative path, text]`, in path order. */
export type SnapshotHeads = [rel: string, head: string][];

// A `FileFold<SnapshotScanContext, SnapshotHeads>` (`plugin-records`),
// spelled structurally: this core is below plugin-records in the plugin graph
// (plugin-records reaches the database through its reports sub-plugin), so
// even a type import of `FileFold` would close a cycle. Each check that folds
// with it types it as one.
export const snapshotHeadsFold = {
  url: import.meta.url,
  scan(
    src: string,
    repoRel: string,
    { dataDir, wholeFile, headChars }: SnapshotScanContext,
  ): SnapshotHeads {
    const prefix = `${dataDir}/`;
    if (!repoRel.startsWith(prefix))
      throw new Error(`snapshot heads: ${repoRel} is not under ${prefix}`);
    const rel = repoRel.slice(prefix.length);
    if (rel === wholeFile) return [[rel, src]];
    // A migration's snapshot header is its first line; a snapshot's head is
    // its first two keys, inside its first `headChars`.
    if (rel.endsWith(".sql")) {
      const eol = src.indexOf("\n");
      return [[rel, eol === -1 ? src : src.slice(0, eol + 1)]];
    }
    return [[rel, src.slice(0, headChars)]];
  },
  combine: (parts: readonly SnapshotHeads[]): SnapshotHeads => parts.flat(),
};
