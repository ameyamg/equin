/**
 * How a captured child ended, in words — the one spelling every failure
 * message uses (`SpawnResult.ended`), so no caller formats it from
 * `exitCode` alone.
 *
 * Why: a child killed by a signal reports `exitCode` 128 + signo, and a
 * message built as `(exit ${r.exitCode})` turned "our own deadline killed it"
 * and "someone else's SIGTERM killed it" into the same `exit 143`. On
 * 2026-11-25 a push's test gate died on `git ls-tree … (exit 143)` and nothing
 * in the error could say who sent the signal (task-1795610805-sg6lfe).
 *
 * - exited on its own → `exit 1`
 * - this call's deadline killed it → `killed by SIGTERM from this call's own
 *   60 s deadline, after 60.0 s awake and 0.12 s of CPU` — the CPU against the
 *   awake time tells a child that was working from one starved of the CPU
 * - any other signal → `killed by SIGTERM, sent from outside this call (not
 *   its deadline; the kernel does not tell a parent who sent it)`
 */
export function describeSpawnEnd(end: {
  exitCode: number;
  signalCode: string | null;
  timedOut: boolean;
  /** The bound that was armed (`timeoutMs`), when the call had one. */
  timeoutMs: number | undefined;
  /** Awake time from spawn to reap. */
  ranMs: number;
  /** User + system CPU the child consumed, when known. */
  cpuTimeMicros: number | undefined;
}): string {
  if (end.timedOut) {
    const signal = end.signalCode ?? `exit ${end.exitCode}`;
    const bound =
      end.timeoutMs === undefined
        ? "deadline"
        : `${seconds(end.timeoutMs)} deadline`;
    const cpu =
      end.cpuTimeMicros === undefined
        ? ""
        : ` and ${seconds(end.cpuTimeMicros / 1000, 2)} of CPU`;
    return `killed by ${signal} from this call's own ${bound}, after ${seconds(end.ranMs, 1)} awake${cpu}`;
  }
  if (end.signalCode !== null) {
    return `killed by ${end.signalCode}, sent from outside this call (not its deadline; the kernel does not tell a parent who sent it)`;
  }
  return `exit ${end.exitCode}`;
}

function seconds(ms: number, digits?: number): string {
  return `${digits === undefined ? String(Math.round(ms / 1000)) : (ms / 1000).toFixed(digits)} s`;
}
