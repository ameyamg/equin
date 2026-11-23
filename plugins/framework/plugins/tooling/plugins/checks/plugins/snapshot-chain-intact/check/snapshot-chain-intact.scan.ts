import type { FileFold } from "@plugins/plugin-meta/plugins/plugin-records/core";

// snapshot-chain-intact's per-file work as a fold kept along the directory
// tree (`defineFoldCheck`): each data-dir file's snapshot-bearing bytes are its
// own record, so a cold store reads each file once as shared record work, and
// a pass after an edit reads only the edited files — never one read per
// migration in the check's own body (1,017 on a fresh clone, over the 1,000 a
// check may make undeclared).
//
// The scan keeps bytes, not facts: the parsing is the migrations plugin's
// (`snapshotFactsOf`, run by the verdict over these heads), and importing its
// barrel here would key every record on ~80 modules the scan never calls. So
// this module imports nothing, and what it must know of the layout comes in
// through the context (part of every record's key).

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

export const snapshotHeadsFold: FileFold<SnapshotScanContext, SnapshotHeads> = {
  url: import.meta.url,
  scan(src, repoRel, { dataDir, wholeFile, headChars }) {
    const prefix = `${dataDir}/`;
    if (!repoRel.startsWith(prefix))
      throw new Error(
        `snapshot-chain-intact: ${repoRel} is not under ${prefix}`,
      );
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
  combine: (parts) => parts.flat(),
};
