import type { BadgeVariant } from "@plugins/primitives/plugins/css/plugins/badge/web";
import type { DecisionRow } from "../../core";

/** How a decision's state reads: its pill's words and colour. */
export interface DecisionPresentation {
  label: string;
  variant: BadgeVariant;
}

/**
 * The pill a decision wears, from its state and its thread: an answer the agent
 * has not acted on yet reads "Sent" whatever the state (the ball is with the
 * agent), an `other` its own state label.
 */
export function decisionPresentation(
  d: Pick<DecisionRow, "state" | "stateLabel" | "unconsumedAnswers">,
): DecisionPresentation {
  if (d.state !== "closed" && d.unconsumedAnswers > 0)
    return { label: "Sent", variant: "muted" };
  switch (d.state) {
    case "decision":
      return { label: "Decision needed", variant: "warning" };
    case "action":
      return { label: "Action needed", variant: "destructive" };
    case "fyi":
      return { label: "FYI", variant: "info" };
    case "other":
      return { label: d.stateLabel ?? "Other", variant: "muted" };
    case "closed":
      return { label: "Closed", variant: "success" };
  }
}
