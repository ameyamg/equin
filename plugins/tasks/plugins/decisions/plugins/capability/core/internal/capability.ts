import { z } from "zod";
import { defineCapability } from "@plugins/tasks/plugins/orchestration/plugins/mandate/plugins/policy/core";

/**
 * May the agent ask the user for a decision: `open_decision`,
 * `update_decision` and `list_decisions` (tasks/decisions). Granted to
 * interactive and supervisor agents only — an automation's agent has no user
 * waiting on it. `true` only.
 */
export const decisionsOpen = defineCapability<true>({
  id: "decisions.open",
  schema: z.literal(true),
  label: "Ask the user for decisions",
});
