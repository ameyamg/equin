/**
 * Which tab of the inbox a decision sits in, derived once on the server
 * (`server/internal/facts.ts`' `decisionTabSql`) from its state and its
 * thread, and read by every surface:
 *
 * - `closed` → **Closed**;
 * - an `answer` the agent has not consumed yet, a question (a note without a
 *   pick) it has not replied to, or `state = other` → **Sent** (the ball is
 *   with the agent: nothing to act on until it updates or replies);
 * - `fyi` → **FYI**;
 * - otherwise → **Needs you**.
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
