import { defineFoldCheck } from "@plugins/framework/plugins/tooling/plugins/checks/core";
import {
  publishedMigrationTreesSignature,
  SNAPSHOT_SCAN_CONTEXT,
  snapshotFactsFiles,
  snapshotHeadsFold,
} from "@plugins/database/plugins/migrations/core";
import { getWorktreeRoot } from "@plugins/infra/plugins/spawn/core";
import { snapshotChainVerdict } from "./verify";

// A fold check: each data-dir file's snapshot head is its record (the
// migrations core's `snapshotHeadsFold`), so the check's own body reads no
// migration — its cost no longer grows with the number of migrations.
const check = defineFoldCheck({
  id: "snapshot-chain-intact",
  description:
    "schema migrations' snapshot lineage forms one DAG (prevId + merge-node parents) with a single root and a single tip, meta/schema.snapshot.json is that tip, and every header id that must have a body resolves to one",
  // INPUT-KEYED: the verdict reads the working tree only through the fold —
  // the data dir's membership (`files`) and each folded file's blob, both
  // recorded by the recording file set — so an edit anywhere else keeps the
  // PASS. What the tree does not hold is git: the published set (a function
  // of the data dir's tree at each published `main`, which the signature
  // names, so a migration landing re-runs it while a push that adds none does
  // not) and the bodies of published and merge nodes (immutable objects of
  // that history).
  inputKeyed: true,
  async cacheSignature(): Promise<string | null> {
    return publishedMigrationTreesSignature(await getWorktreeRoot());
  },
  context: () => SNAPSHOT_SCAN_CONTEXT,
  files: (repo) => snapshotFactsFiles(repo),
  facts: () => null,
  fold: snapshotHeadsFold,
  async verdict(heads, _inputs, ctx) {
    return snapshotChainVerdict(heads, (await ctx.repo()).root);
  },
});

export default check;
