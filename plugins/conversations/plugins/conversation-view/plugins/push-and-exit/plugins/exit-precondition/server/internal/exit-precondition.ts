import { defineServerContribution } from "@plugins/framework/plugins/server-core/core";

/**
 * What must hold before an agent may close its conversation with
 * `exit_clean`: contributed by the plugin that owns the condition (the tasks
 * plugin: no sidequest the agent filed is left waiting), so `exit_clean`
 * names none. A precondition that fails refuses the exit and nothing is
 * written; its message tells the agent what to do first.
 *
 * Only `exit_clean` is gated: `flag_raise` keeps the conversation open for a
 * person, who sees whatever is left.
 */
export interface ExitCleanPreconditionEntry {
  /** Unique (diagnostics). */
  id: string;
  /** `null` when the agent may exit; otherwise what is in the way and how to
   * clear it, addressed to the agent. */
  check: (
    conversationId: string,
    exit: CleanExitKind,
  ) => Promise<{ message: string } | null>;
}

/**
 * How the conversation ends. `handedOver`: its task's work goes on in a
 * successor session that takes over what the ending one holds (a supervisor's
 * `handoff`: its open decisions move to the successor), so a precondition
 * about what only the ending conversation could settle need not hold.
 */
export interface CleanExitKind {
  handedOver: boolean;
}

const PreconditionToken = defineServerContribution<ExitCleanPreconditionEntry>(
  "exitCleanPrecondition",
  { docLabel: (p) => p.id },
);

/** Registers a precondition — `ExitClean.Precondition({ id, check })`. */
export const ExitClean = { Precondition: PreconditionToken };

/** The messages of every precondition that fails for `conversationId`,
 * empty when it may exit. */
export async function exitCleanRefusals(
  conversationId: string,
  exit: CleanExitKind = { handedOver: false },
): Promise<string[]> {
  const out: string[] = [];
  for (const entry of PreconditionToken.getContributions()) {
    const refusal = await entry.check(conversationId, exit);
    if (refusal !== null) out.push(refusal.message);
  }
  return out;
}
