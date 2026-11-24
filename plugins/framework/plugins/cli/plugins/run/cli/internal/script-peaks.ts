import {
  defineFileSink,
  readHistory,
} from "@plugins/infra/plugins/file-sink/core";
import { wallNow } from "@plugins/packages/plugins/deadline/core";
import { scriptPeaksLogDir } from "../../data-dirs";
import {
  peaksOfScript,
  ScriptPeakRecordSchema,
  type ScriptPeakRecord,
} from "./script-weight";

// The script-peak ledger: one line per finished plain `./equin run` script,
// appended by the run that measured it and read by the next run of any
// script, in any checkout (it is host-wide: the same repo path is the same
// script in every worktree).

const PEAKS_FILE = scriptPeaksLogDir.file("script-peaks.jsonl");

// ~110 bytes a line and ~250 runs a day on this host: 1 MB holds ~5 weeks,
// more than the window reads. A run reads it whole before it starts (one
// sequential read, a few ms) — the only cost a light script pays.
const MAX_LINES = 20_000;
const peaksSink = defineFileSink({
  id: "script-peaks",
  description:
    "One JSONL line per finished `./equin run` script on this host: the script and its process's peak footprint — what decides whether its next run is admitted as heavy work.",
  path: PEAKS_FILE,
  maxBytes: 1024 * 1024,
  keep: 1,
});

/** Append one finished run to the ledger. */
export async function recordScriptPeak(
  script: string,
  peakBytes: number,
): Promise<void> {
  const record: ScriptPeakRecord = {
    t: new Date().toISOString(),
    script,
    peakBytes,
  };
  await peaksSink.append(JSON.stringify(ScriptPeakRecordSchema.parse(record)));
}

/**
 * `script`'s recorded peaks inside the window, oldest first. A line this
 * version cannot read (torn by a crash mid-append, another version's shape)
 * is left out: it is one run's measurement, and the script's other runs
 * still stand.
 */
export async function readScriptPeaks(script: string): Promise<number[]> {
  const now = wallNow("lookback");
  const lines = await readHistory(PEAKS_FILE, {
    before: null,
    notBefore: null,
    limit: MAX_LINES,
  });
  const records: ScriptPeakRecord[] = [];
  for (const { text } of lines) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      continue;
    }
    const r = ScriptPeakRecordSchema.safeParse(json);
    if (r.success) records.push(r.data);
  }
  return peaksOfScript(records, script, now);
}
