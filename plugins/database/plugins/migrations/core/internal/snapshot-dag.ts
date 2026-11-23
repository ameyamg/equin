/**
 * The drizzle snapshot DAG — one definition of its edges, read by the CLI's
 * generate pipeline (which joins tips with a merge node and stages drizzle-kit's
 * view of it) and by the `snapshot-chain-intact` / `migrations-in-sync` checks.
 *
 * Every schema migration is one node, identified by its `.sql` basename. Its
 * lineage comes from the `.sql`'s snapshot header (`snapshotLineage`,
 * `./phases`) or, for a migration from before the snapshot cutover, from
 * `meta/legacy-snapshots.json` (or a not-yet-folded `meta/<tag>_snapshot.json`)
 * — see `./schema-snapshot`. No snapshot BODY is read here. A node's parent is
 * its `prevId`, except a MERGE NODE's, whose parents are all the ids its header
 * names. A healthy history is a DAG with exactly one root and exactly one tip:
 * a checkout that merged another `main` (an upstream update) forks at the merge
 * base and re-joins at the merge node. See
 * research/2026-09-30-global-clone-migrations-published-set.md §3 and
 * research/2026-10-22-global-single-live-migration-snapshot.md.
 */
import type { AppPath } from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import { createSemaphore } from "@plugins/packages/plugins/semaphore/core";
import { snapshotLineage } from "@plugins/database/plugins/migrations/plugins/phases/core";
import {
  diskMigrationData,
  legacySnapshotFilesIn,
  type MigrationData,
} from "./migration-data";
import {
  LEGACY_SNAPSHOT_SUFFIX,
  LEGACY_SNAPSHOTS_FILE,
  legacySnapshotSql,
  parseLegacySnapshots,
  parseSnapshotHead,
  readSnapshotHead,
  SCHEMA_SNAPSHOT_FILE,
  schemaSnapshotPath,
  type SnapshotHead,
} from "./schema-snapshot";

/** How many migration headers `readSnapshotNodes` reads at once. */
const HEADER_READ_CONCURRENCY = 32;

/** drizzle's `prevId` of the first snapshot. */
export const NULL_SNAPSHOT_ID = "00000000-0000-0000-0000-000000000000";

/** One snapshot, as far as the DAG is concerned. */
export interface SnapshotNode {
  /** The schema migration's `.sql` basename. */
  file: string;
  id: string;
  /** drizzle's single parent: a merge node's parent that sorts last. */
  prevId: string;
  /** Every parent, when the migration is a merge node. */
  mergeParents: readonly string[] | null;
  /**
   * Where its lineage is recorded: its own `.sql` header, or (written before
   * the snapshot cutover) `legacy-snapshots.json` / a `<tag>_snapshot.json`.
   * Says where its BODY lives in git (`./snapshot-bodies`).
   */
  lineage: "header" | "legacy";
}

/** Why a set of snapshots is not a single-root, single-tip DAG. */
export type SnapshotDagProblem =
  | { kind: "duplicate-id"; id: string; files: string[] }
  | { kind: "missing-parent"; file: string; parent: string }
  | { kind: "merge-prev-not-parent"; file: string }
  | { kind: "no-root" }
  | { kind: "multiple-roots"; files: string[] }
  | { kind: "cycle"; files: string[] }
  | { kind: "unreachable"; files: string[] }
  | { kind: "multiple-tips"; files: string[] };

export interface SnapshotDag {
  byId: ReadonlyMap<string, SnapshotNode>;
  /** Parent ids of a node (only those present). */
  parentsOf(id: string): readonly string[];
  roots: readonly SnapshotNode[];
  /** Nodes no other node names as a parent, in file order. */
  tips: readonly SnapshotNode[];
  /** Every structural problem, `multiple-tips` included. */
  problems: readonly SnapshotDagProblem[];
}

/** A node's declared parent ids: the merge header's, else its `prevId`. */
export function declaredParents(n: SnapshotNode): readonly string[] {
  if (n.mergeParents) return n.mergeParents;
  return n.prevId === NULL_SNAPSHOT_ID ? [] : [n.prevId];
}

/** PURE: the DAG over `nodes`, and everything wrong with it. */
export function analyzeSnapshotDag(
  nodes: readonly SnapshotNode[],
): SnapshotDag {
  const sorted = [...nodes].sort((a, b) => a.file.localeCompare(b.file));
  const problems: SnapshotDagProblem[] = [];

  const byId = new Map<string, SnapshotNode>();
  const dupes = new Map<string, string[]>();
  for (const n of sorted) {
    const prior = byId.get(n.id);
    if (prior) {
      const files = dupes.get(n.id) ?? [prior.file];
      files.push(n.file);
      dupes.set(n.id, files);
      continue;
    }
    byId.set(n.id, n);
  }
  for (const [id, files] of dupes)
    problems.push({ kind: "duplicate-id", id, files });

  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const n of byId.values()) {
    if (n.mergeParents && !n.mergeParents.includes(n.prevId))
      problems.push({ kind: "merge-prev-not-parent", file: n.file });
    const present: string[] = [];
    for (const p of declaredParents(n)) {
      if (!byId.has(p)) {
        problems.push({ kind: "missing-parent", file: n.file, parent: p });
        continue;
      }
      if (present.includes(p)) continue;
      present.push(p);
      const list = children.get(p) ?? [];
      list.push(n.id);
      children.set(p, list);
    }
    parents.set(n.id, present);
  }

  const all = [...byId.values()];
  const roots = all.filter((n) => declaredParents(n).length === 0);
  const tips = all.filter((n) => !children.has(n.id));
  if (all.length > 0 && roots.length === 0) problems.push({ kind: "no-root" });
  if (roots.length > 1)
    problems.push({ kind: "multiple-roots", files: roots.map((r) => r.file) });

  // Kahn's order: whatever it cannot reach sits on (or behind) a cycle.
  const indegree = new Map(all.map((n) => [n.id, parents.get(n.id)!.length]));
  const queue = all.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const ordered = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    ordered.add(id);
    for (const c of children.get(id) ?? []) {
      const d = indegree.get(c)! - 1;
      indegree.set(c, d);
      if (d === 0) queue.push(c);
    }
  }
  const cyclic = all.filter((n) => !ordered.has(n.id));
  if (cyclic.length > 0)
    problems.push({ kind: "cycle", files: cyclic.map((n) => n.file) });

  // With one root, every node must descend from it. (Several roots are
  // already a problem of their own; reachability from each adds nothing.)
  if (roots.length === 1 && cyclic.length === 0) {
    const reached = new Set<string>([roots[0]!.id]);
    const stack = [roots[0]!.id];
    while (stack.length > 0) {
      for (const c of children.get(stack.pop()!) ?? []) {
        if (reached.has(c)) continue;
        reached.add(c);
        stack.push(c);
      }
    }
    const unreachable = all.filter((n) => !reached.has(n.id));
    if (unreachable.length > 0)
      problems.push({
        kind: "unreachable",
        files: unreachable.map((n) => n.file),
      });
  }

  // In a finite acyclic graph every node reaches some tip, so one tip means
  // every node reaches it.
  if (tips.length > 1)
    problems.push({ kind: "multiple-tips", files: tips.map((t) => t.file) });

  return {
    byId,
    parentsOf: (id) => parents.get(id) ?? [],
    roots,
    tips,
    problems,
  };
}

/** PURE: `id` and every node it descends from. */
export function snapshotAncestors(dag: SnapshotDag, id: string): Set<string> {
  const seen = new Set<string>([id]);
  const stack = [id];
  while (stack.length > 0) {
    for (const p of dag.parentsOf(stack.pop()!)) {
      if (seen.has(p)) continue;
      seen.add(p);
      stack.push(p);
    }
  }
  return seen;
}

/**
 * What the data dir's files say about the snapshot DAG, each file on its own
 * bytes: a `.sql`'s snapshot header, `meta/legacy-snapshots.json`'s entries, a
 * not-yet-folded `meta/<tag>_snapshot.json`'s head, and the tip file's head.
 * Plain JSON, one file's facts a function of that file alone, and
 * {@link combineSnapshotFacts} associative — so a check can keep each file's
 * head as a plugin record (snapshot-chain-intact's fold) and re-read only the
 * files an edit touched. {@link snapshotNodesOf} turns them
 * into the DAG's nodes; {@link readSnapshotNodes} is the same, read in one go.
 */
export interface SnapshotFacts {
  /** Each `.sql` with a snapshot header (data-dir-relative), in path order. */
  headers: { file: string; id: string; parents: string[] }[];
  /** `meta/legacy-snapshots.json`'s entries in file order; null without the file. */
  legacy: { tag: string; id: string; prevId: string }[] | null;
  /** Each `meta/<tag>_snapshot.json`'s head, by its basename, in path order. */
  legacyFiles: { file: string; id: string; prevId: string }[];
  /** `meta/schema.snapshot.json`'s head; null without the file. */
  tip: SnapshotHead | null;
}

export const NO_SNAPSHOT_FACTS: SnapshotFacts = {
  headers: [],
  legacy: null,
  legacyFiles: [],
  tip: null,
};

/** Whether data-dir-relative `rel` is a file {@link snapshotFactsOf} reads. */
export function isSnapshotFactsFile(rel: string): boolean {
  if (!rel.includes("/")) return rel.endsWith(".sql");
  if (!rel.startsWith("meta/")) return false;
  const name = rel.slice("meta/".length);
  return (
    !name.includes("/") &&
    (name === LEGACY_SNAPSHOTS_FILE ||
      name === SCHEMA_SNAPSHOT_FILE ||
      name.endsWith(LEGACY_SNAPSHOT_SUFFIX))
  );
}

/**
 * PURE: the facts data-dir-relative `rel` states, from `src` — the whole file,
 * or its head: a `.sql`'s first line (its snapshot header), a snapshot's first
 * `SNAPSHOT_HEAD_BYTES`. `legacy-snapshots.json` is read whole.
 */
export function snapshotFactsOf(rel: string, src: string): SnapshotFacts {
  if (!rel.includes("/")) {
    if (!rel.endsWith(".sql")) return NO_SNAPSHOT_FACTS;
    const lineage = snapshotLineage(src);
    return lineage === null
      ? NO_SNAPSHOT_FACTS
      : {
          ...NO_SNAPSHOT_FACTS,
          headers: [
            { file: rel, id: lineage.id, parents: [...lineage.parents] },
          ],
        };
  }
  if (!isSnapshotFactsFile(rel)) return NO_SNAPSHOT_FACTS;
  const name = rel.slice("meta/".length);
  if (name === LEGACY_SNAPSHOTS_FILE)
    return {
      ...NO_SNAPSHOT_FACTS,
      legacy: [...parseLegacySnapshots(src, rel)].map(([tag, head]) => ({
        tag,
        ...head,
      })),
    };
  if (name === SCHEMA_SNAPSHOT_FILE)
    return { ...NO_SNAPSHOT_FACTS, tip: parseSnapshotHead(src, rel) };
  if (name.endsWith(LEGACY_SNAPSHOT_SUFFIX))
    return {
      ...NO_SNAPSHOT_FACTS,
      legacyFiles: [{ file: name, ...parseSnapshotHead(src, rel) }],
    };
  return NO_SNAPSHOT_FACTS;
}

/** PURE, associative: several files' facts as one (parts in path order). */
export function combineSnapshotFacts(
  parts: readonly SnapshotFacts[],
): SnapshotFacts {
  return {
    headers: parts.flatMap((p) => p.headers),
    legacy: parts.find((p) => p.legacy !== null)?.legacy ?? null,
    legacyFiles: parts.flatMap((p) => p.legacyFiles),
    tip: parts.find((p) => p.tip !== null)?.tip ?? null,
  };
}

/**
 * PURE: every schema migration the facts name, as a DAG node: one per
 * `legacy-snapshots.json` entry, one per not-yet-folded `<tag>_snapshot.json`
 * whose tag is not already a legacy key, and one per `.sql` header. A legacy
 * entry whose `.sql` is gone is still a node (`migration-metadata-consistent`
 * owns that orphan).
 */
export function snapshotNodesOf(facts: SnapshotFacts): SnapshotNode[] {
  const nodes: SnapshotNode[] = [];
  const legacyTags = new Set<string>();
  for (const { tag, id, prevId } of facts.legacy ?? []) {
    legacyTags.add(tag);
    nodes.push({
      file: `${tag}.sql`,
      id,
      prevId,
      mergeParents: null,
      lineage: "legacy",
    });
  }
  for (const { file, id, prevId } of facts.legacyFiles) {
    const sql = legacySnapshotSql(file);
    if (facts.legacy !== null && legacyTags.has(sql.slice(0, -".sql".length)))
      continue;
    nodes.push({
      file: sql,
      id,
      prevId,
      mergeParents: null,
      lineage: "legacy",
    });
  }
  for (const { file, id, parents } of facts.headers)
    nodes.push({
      file,
      id,
      prevId: parents[parents.length - 1]!,
      mergeParents: parents.length > 1 ? parents : null,
      lineage: "header",
    });
  return nodes;
}

/**
 * Every schema migration under the data dir as a DAG node
 * ({@link snapshotNodesOf}). Only the start of each `.sql` and legacy
 * snapshot is read.
 *
 * `from`: the data dir on disk, or a `MigrationData` (a caller's file set —
 * `./migration-data`).
 */
export async function readSnapshotNodes(
  from: AppPath | MigrationData,
): Promise<SnapshotNode[]> {
  const data = typeof from === "string" ? diskMigrationData(from) : from;
  const legacyRel = `meta/${LEGACY_SNAPSHOTS_FILE}`;
  const legacyText = await data.text(legacyRel);
  const parts: SnapshotFacts[] = [
    legacyText === null
      ? NO_SNAPSHOT_FACTS
      : snapshotFactsOf(legacyRel, legacyText),
  ];
  for (const file of await legacySnapshotFilesIn(data)) {
    const rel = `meta/${file}`;
    const start = await data.start(rel);
    if (start === null) throw new Error(`${rel} was listed but cannot be read`);
    parts.push(snapshotFactsOf(rel, start));
  }
  // Every header read asynchronously, through a bounded gate: a blocking read
  // per migration held the check thread for seconds.
  const files = (await data.files()).filter((f) => f.endsWith(".sql"));
  const reads = createSemaphore(HEADER_READ_CONCURRENCY);
  parts.push(
    ...(await Promise.all(
      files.map((file) =>
        reads.run(async () => {
          const start = await data.start(file);
          return start === null
            ? NO_SNAPSHOT_FACTS
            : snapshotFactsOf(file, start);
        }),
      ),
    )),
  );
  return snapshotNodesOf(combineSnapshotFacts(parts));
}

/** Whether `schema.snapshot.json` is the body of the DAG's single tip. */
export type SchemaSnapshotState = { ok: true } | { ok: false; message: string };

/**
 * The invariant every drizzle-kit run rests on: `meta/schema.snapshot.json` is
 * the body of the DAG's single tip — its `id` is the tip's id (and it exists
 * whenever the DAG has a node). Not judged on a multi-tip DAG: that is its own
 * problem (`analyzeSnapshotDag`), and the join rewrites the file anyway.
 */
export function schemaSnapshotState(
  dataDir: AppPath,
  dag: SnapshotDag,
): SchemaSnapshotState {
  if (dag.tips.length !== 1) return { ok: true };
  return judgeSchemaSnapshot(
    readSnapshotHead(schemaSnapshotPath(dataDir)),
    dag,
  );
}

/**
 * PURE: `schemaSnapshotState` of a tip file whose head is `head` (null:
 * missing) — what a caller holding the head already (a check's fold) judges.
 */
export function judgeSchemaSnapshot(
  head: SnapshotHead | null,
  dag: SnapshotDag,
): SchemaSnapshotState {
  if (dag.tips.length !== 1) return { ok: true };
  const tip = dag.tips[0]!;
  if (head === null)
    return {
      ok: false,
      message: `meta/${SCHEMA_SNAPSHOT_FILE} is missing; the snapshot DAG's tip is ${tip.file} (${tip.id}).`,
    };
  if (head.id !== tip.id)
    return {
      ok: false,
      message: `meta/${SCHEMA_SNAPSHOT_FILE} is snapshot ${head.id}, but the snapshot DAG's tip is ${tip.file} (${tip.id}).`,
    };
  return { ok: true };
}
