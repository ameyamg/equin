import { z } from "zod";
import { defineCapability } from "@plugins/tasks/plugins/orchestration/plugins/mandate/plugins/policy/core";

/** Its runs are handed back to whoever started them (a supervisor, an
 * automation): a run's last message is its outcome report, and once the user
 * has talked to it the agent says whom each turn is for (`turn_for`). */
export const reportRequired = defineCapability<true>({
  id: "report.required",
  schema: z.literal(true),
  label: "Report required",
});
