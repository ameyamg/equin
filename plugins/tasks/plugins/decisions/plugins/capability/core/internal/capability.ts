import { z } from "zod";
import { defineCapability } from "@plugins/tasks/plugins/orchestration/plugins/mandate/plugins/policy/core";

/**
 * May the agent ask the user for a decision: `open_decision`,
 * `update_decision` and `list_decisions` (tasks/decisions). Granted to a
 * supervisor's root only: a worker raises what needs the user to its
 * supervisor, and an interactive or automated agent's user is the one it
 * talks to (or none). `true` only.
 */
export const decisionsOpen = defineCapability<true>({
  id: "decisions.open",
  schema: z.literal(true),
  label: "Ask the user for decisions",
});
