import type {
  TestFileOutcome,
  TestRunRecord,
} from "@plugins/framework/plugins/cli/plugins/test/plugins/record/core";

/** One file's verdict as a harvested run recorded it. */
export interface RecordedVerdict {
  outcome: TestFileOutcome;
  /** When the run that recorded it started (ISO). */
  startedAt: string;
  /** The namespace the run ran in. */
  slug: string;
  /** How many cases ran, and their failing ids (`<suite> > … > <case>`). */
  cases: number;
  failedCaseIds: readonly string[];
  durationMs: number;
}

/**
 * Every harvested verdict on the host, indexed the ways the gate asks:
 * by (file, digest) — verdicts about exactly this code, wherever they ran —
 * and by file on main's own checkout, at any digest.
 */
export interface VerdictIndex {
  /** Every verdict at (`path`, `digest`), newest first. */
  at(path: string, digest: string): readonly RecordedVerdict[];
  /** Every verdict for `path` from runs on main's checkout, newest first. */
  onMain(path: string): readonly RecordedVerdict[];
  /** The file's last known duration (ms), any run, any digest. */
  durationOf(path: string): number | null;
}

function append<V>(m: Map<string, V[]>, key: string, v: V): void {
  const list = m.get(key);
  if (list === undefined) m.set(key, [v]);
  else list.push(v);
}

const newestFirst = (a: RecordedVerdict, b: RecordedVerdict): number =>
  a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0;

/** `records` (any order) as a {@link VerdictIndex}; `mainSlug` is main's namespace. */
export function buildVerdictIndex(
  records: readonly TestRunRecord[],
  mainSlug: string,
): VerdictIndex {
  const byKey = new Map<string, RecordedVerdict[]>();
  const byMainPath = new Map<string, RecordedVerdict[]>();
  const latest = new Map<string, RecordedVerdict>();
  for (const r of records) {
    const failedBy = new Map<string, string[]>();
    for (const f of r.failures) append(failedBy, f.path, f.caseId);
    for (const f of r.files) {
      const v: RecordedVerdict = {
        outcome: f.outcome,
        startedAt: r.startedAt,
        slug: r.slug,
        cases: f.cases,
        failedCaseIds: failedBy.get(f.path) ?? [],
        durationMs: f.durationMs,
      };
      append(byKey, `${f.path}\0${f.digest}`, v);
      if (r.slug === mainSlug) append(byMainPath, f.path, v);
      const prev = latest.get(f.path);
      if (prev === undefined || newestFirst(v, prev) < 0) latest.set(f.path, v);
    }
  }
  for (const list of byKey.values()) list.sort(newestFirst);
  for (const list of byMainPath.values()) list.sort(newestFirst);
  return {
    at: (path, digest) => byKey.get(`${path}\0${digest}`) ?? [],
    onMain: (path) => byMainPath.get(path) ?? [],
    durationOf: (path) => latest.get(path)?.durationMs ?? null,
  };
}
