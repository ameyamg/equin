/**
 * One gate's result: the named suite (`checks`, `tests`, `web build`, or `smoke: <name>`)
 * and the stable identity of every failure in it.
 */
export interface GateResult {
  gate: string;
  failures: string[];
}

/**
 * What a failure is a failure OF: the text before its first ` > ` — a test
 * file for `<file> > <test>`, the whole id for a check, a smoke test or a
 * synthetic `(… exited n)`.
 */
export function failureSubject(failure: string): string {
  const at = failure.indexOf(" > ");
  return at === -1 ? failure : failure.slice(0, at);
}

/**
 * The failures `after` has whose SUBJECT (`failureSubject`) had no failure in
 * `before`, per gate — the candidate's regressions, before any retry.
 *
 * Compared per subject, not per failure: a subject that already fails on the
 * baseline cannot witness a regression, whichever of its cases fail. A test
 * file whose failing cases change from run to run — with the suite around it,
 * with the order, alone or in-suite (health-report.test.tsx, 2026-11-23: a
 * different handful each run, on the baseline too) — would otherwise read as a
 * new failure on every candidate, reproduce on every retry, and send the
 * narrowing after noise. Its failures stay on the receipt as `blind`.
 */
export function newFailures(
  before: readonly GateResult[],
  after: readonly GateResult[],
): GateResult[] {
  const out: GateResult[] = [];
  for (const { gate, failures } of after) {
    const blind = new Set(
      (before.find((b) => b.gate === gate)?.failures ?? []).map(failureSubject),
    );
    const fresh = failures.filter((f) => !blind.has(failureSubject(f)));
    if (fresh.length > 0) out.push({ gate, failures: fresh });
  }
  return out;
}

/**
 * The regressions that happened AGAIN on a retry: a failure is kept only if the
 * retried gate still has it. A retry that passes is how a flaky failure is told
 * from one the new toolchain caused.
 */
export function confirmedFailures(
  suspected: readonly GateResult[],
  retried: readonly GateResult[],
): GateResult[] {
  const out: GateResult[] = [];
  for (const { gate, failures } of suspected) {
    const still = new Set(retried.find((r) => r.gate === gate)?.failures ?? []);
    const kept = failures.filter((f) => still.has(f));
    if (kept.length > 0) out.push({ gate, failures: kept });
  }
  return out;
}
