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
  const key = `${path}\0${scopeId ?? ""}`;
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
 * Every registered document with a merge record — base and each app scope the
 * store holds. A document without one costs one stamp.
 */
export async function listAutoMerges(): Promise<AutoMergeSummary[]> {
  const store = ConfigStore.get();
  const out: AutoMergeSummary[] = [];
  for (const [path] of getAllDescriptors()) {
    for (const scopeId of [undefined, ...(await store.scopes(path))]) {
      const summary = await documentSummary(path, scopeId);
      if (summary !== null) out.push(summary);
    }
  }
  return out.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
}
