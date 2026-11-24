import { defineIdKind, type IdOf } from "@plugins/ids/core";

/** A decision (`decisions.id`), minted by `open_decision`. */
export const decisionIdKind = defineIdKind({
  prefix: "dec",
  label: "Decision",
});
export type DecisionId = IdOf<typeof decisionIdKind>;

/** One exchange of a decision's thread (`decision_exchanges.id`). */
export const decisionExchangeIdKind = defineIdKind({
  prefix: "dex",
  label: "Decision exchange",
});
export type DecisionExchangeId = IdOf<typeof decisionExchangeIdKind>;
