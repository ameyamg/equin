import type { DecisionExchangeRow } from "../../core";

/**
 * The thread as it stood when a past version was replaced (`end`: the next
 * version's time): the exchanges written by then, an agent reply written
 * later left out. The thread itself is not versioned (append-only), so a
 * past version's thread is cut from the current one — what the user wrote
 * against that version stays readable there after the agent rewrites the
 * decision. A reply recorded at the instant of `end` is the edit that made
 * the next version, so it belongs to this one.
 */
export function threadAsOf(
  exchanges: readonly DecisionExchangeRow[],
  end: Date,
): DecisionExchangeRow[] {
  return exchanges
    .filter((e) => e.createdAt <= end)
    .map((e) =>
      e.agentAt !== null && e.agentAt > end
        ? { ...e, agentText: null, agentAt: null }
        : e,
    );
}
