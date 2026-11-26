import { z } from "zod";
import { defineCapability } from "@plugins/tasks/plugins/orchestration/plugins/mandate/plugins/policy/core";

/**
 * May switch its own task to the supervisor mandate (`become_supervisor`):
 * an agent whose task turned out too big for one context becomes the
 * supervisor of a tree it splits the work into. `true` only — no grant, no
 * tool.
 */
export const mandateEscalate = defineCapability<true>({
  id: "mandate.escalate",
  schema: z.literal(true),
  label: "Switch its own task to supervisor",
});
