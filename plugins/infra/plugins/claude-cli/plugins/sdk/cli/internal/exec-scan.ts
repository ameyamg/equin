import { sep } from "node:path";
import { spawnCaptured } from "@plugins/infra/plugins/spawn/core";
import { backgroundArgv } from "@plugins/packages/plugins/spawn-priority/core";
import { realpath } from "@plugins/packages/plugins/timed-fs/core";
import { bundledClaudeBin } from "../../machine";

/** A `--version` run takes milliseconds once scanned; the scan itself ~3 s. */
const SCAN_TIMEOUT_MS = 60_000;

/**
 * Have macOS scan the checkout's Claude Code now, before its backend starts:
 * run `<root>'s bundled claude --version` once, at background priority.
 *
 * Why: macOS scans an executable on its first exec at a path (Gatekeeper's
 * malware scan — ~3 s for the 344 MB claude, then 0.02 s). An install can give
 * a checkout a new claude file (a new main slot, a reinstall that re-clones
 * its store), and the first exec then came from the backend just restarted on
 * it: the Claude Code probe (`claude-cli/availability`) waited on the scan —
 * 3.5–4.9 s after main's restarts instead of ~0.5 s — and so did every other
 * code-signing check queued behind it in syspolicyd at that moment (the
 * gateway-drift `codesign -v`, 3–4 s for 0.1 s of work). Paid in the build
 * instead, the restart finds a scanned file. Already scanned, this costs one
 * ~20 ms exec.
 *
 * Not an SDK read: the output is not read, only the exec matters (the same
 * warm-up runtime-sdk's `warm-claude-clones` does for per-conversation clones).
 * Off macOS there is no first-exec scan, so nothing runs.
 *
 * Throws when the bundled build is missing, is not the one installed in
 * `root`, or does not run — a broken install the backend would only report
 * later as an unreadable Claude Code.
 */
export async function scanBundledClaudeNow({
  root,
  log,
}: {
  /** The checkout being built: the claude its backend will run must be under it. */
  root: string;
  log: (line: string) => void;
}): Promise<void> {
  if (process.platform !== "darwin") return;
  const bin = await bundledClaudeBin();
  // This code runs from the checkout it builds, so it resolves that
  // checkout's install; one that resolved another's would warm the wrong file.
  const [realBin, realRoot] = await Promise.all([
    realpath(bin),
    realpath(root),
  ]);
  if (!realBin.startsWith(realRoot + sep)) {
    throw new Error(
      `The bundled Claude Code resolved to ${realBin}, outside the checkout being built (${realRoot})`,
    );
  }
  const started = performance.now();
  const run = await spawnCaptured(backgroundArgv([bin, "--version"]), {
    timeoutMs: SCAN_TIMEOUT_MS,
  });
  if (run.exitCode !== 0 || run.timedOut) {
    throw new Error(
      `${bin} --version ${run.timedOut ? "timed out" : `exited ${String(run.signalCode ?? run.exitCode)}`}: ${run.stderr.trim()}`,
    );
  }
  log(
    `  Claude Code ${run.stdout.trim()} ran once (${Math.round(performance.now() - started)} ms)`,
  );
}
