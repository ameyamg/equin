import {
  ConfigStore,
  getAllDescriptors,
  readAutoMerge,
  type AutoMergeState,
} from "@plugins/config_v2/server";
import type { AutoMergeSummary } from "../../core";

/** One document's record as the list shows it. */
export function summarize(
  path: string,
  scopeId: string | undefined,
  { record, status }: AutoMergeState,
): AutoMergeSummary {
  return {
    path,
    ...(scopeId ? { scopeId } : {}),
    id: record.id,
    mergedAt: record.mergedAt,
    status,
    notes: record.decisions.length,
    removedFields: record.decisions
      .filter((d) => d.kind === "removed-dropped")
      .map((d) => d.path.join(".")),
    ...(record.acknowledgedAt ? { acknowledgedAt: record.acknowledgedAt } : {}),
    ...(record.notifiedAt ? { notifiedAt: record.notifiedAt } : {}),
  };
}

type Ref = Parameters<ReturnType<typeof ConfigStore.get>["stamp"]>[0];

/**
 * Each document's summary as of its files' stamps (the record, the origin and
 * the override: what the summary and its status are a function of) — the
 * conflict-locations pattern. The list reloads on every document change, so
 * an unchanged document costs its stamps, never a read and a parse. Founded on
 * the store, not on events: a missed event cannot leave a wrong answer.
 */
const memo = new Map<
  string,
  { stamp: string; summary: AutoMergeSummary | null }
>();

const memoKey = (path: string, scopeId: string | undefined): string =>
  `${path}\0${scopeId ?? ""}`;

async function documentSummary(
  path: string,
  scopeId: string | undefined,
): Promise<AutoMergeSummary | null> {
  const store = ConfigStore.get();
  const ref = (file: Ref["file"]): Ref => ({
    storePath: path,
    ...(scopeId ? { scopeId } : {}),
    file,
  });
  const key = memoKey(path, scopeId);
  const mergeStamp = await store.stamp(ref("merge"));
  if (mergeStamp === "-") {
    memo.delete(key);
    return null;
  }
  const stamp = [
    mergeStamp,
    await store.stamp(ref("origin")),
    await store.stamp(ref("override")),
  ].join("|");
  const hit = memo.get(key);
  if (hit?.stamp === stamp) return hit.summary;
  const state = await readAutoMerge(path, scopeId);
  const summary = state === null ? null : summarize(path, scopeId, state);
  memo.set(key, { stamp, summary });
  return summary;
}

/**
 * Every registered document with a merge record — base and each app scope.
 * The store lists the documents holding one (one listing of the layer), so a
 * load costs the few records' stamps, never a probe per registered descriptor
 * and scope.
 */
export async function listAutoMerges(): Promise<AutoMergeSummary[]> {
  // getAllDescriptors, not a per-path lookup: it refuses a partial start,
  // where a record of a config this process did not register would vanish.
  const registered = new Set(getAllDescriptors().map(([path]) => path));
  const out: AutoMergeSummary[] = [];
  const listed = new Set<string>();
  for (const { storePath, scopeId } of await ConfigStore.get().documentsWith(
    "merge",
  )) {
    // A record left under a config no longer registered is the orphan
    // audit's (noise), not a merge to show.
    if (!registered.has(storePath)) continue;
    listed.add(memoKey(storePath, scopeId));
    const summary = await documentSummary(storePath, scopeId);
    if (summary !== null) out.push(summary);
  }
  for (const key of memo.keys()) if (!listed.has(key)) memo.delete(key);
  return out.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
}
