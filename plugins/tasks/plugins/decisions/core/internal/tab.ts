/**
 * Which tab of the inbox a decision sits in, derived once on the server
 * (`server/internal/facts.ts`' `decisionTabSql`) from its state and its
 * thread, and read by every surface:
 *
 * - `closed` → **Closed**;
 * - an `answer` the agent has not consumed yet, or `state = other` → **Sent**
 *   (the ball is with the agent);
 * - `fyi` → **FYI**;
 * - otherwise → **Needs you** (a question the agent has not replied to keeps
 *   it here: the user asked, the decision is still theirs).
 *
 * Ordered: a window sorted by it reads Needs you first.
 */
export const DECISION_TABS = ["needs", "sent", "fyi", "closed"] as const;
export type DecisionTab = (typeof DECISION_TABS)[number];

/** Each tab's label, as the `tab` field's options. */
export const DECISION_TAB_OPTIONS = {
  needs: { label: "Needs you", variant: "primary" },
  sent: { label: "Sent" },
  fyi: { label: "FYI" },
  closed: { label: "Closed" },
} as const;
