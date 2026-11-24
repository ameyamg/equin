import { defineDataDir } from "@plugins/infra/plugins/paths/core";

/**
 * The script-peak ledger (`script-peaks.jsonl` + rotation): one line per
 * finished plain `./equin run` script — which script, and the peak physical
 * footprint its process reported at exit. What decides whether that script's
 * next run takes a host memory share before it starts (`scriptWeight`).
 */
export const scriptPeaksLogDir = defineDataDir({
  kind: "logs",
  name: "script-peaks",
  owner: "framework/cli/run",
  description:
    "Per finished `./equin run` script on this host (`script-peaks.jsonl` + rotation): the script and its process's peak footprint — what decides whether its next run is admitted as heavy work",
  // A record of past runs, not state anything needs to run: lost, every
  // script starts unadmitted again until a run shows it heavy.
  reclaim: { kind: "safe" },
  logs: [{ pattern: "script-peaks.jsonl", bound: { kind: "file-sink" } }],
});

export default [scriptPeaksLogDir];
