import { z } from "zod";
import { defineCapability } from "@plugins/tasks/plugins/orchestration/plugins/mandate/plugins/policy/core";

/**
 * A person's grant on ONE task: its own conversation may `edit_task` /
 * `drop_task` tasks it does not own. Never part of a named mandate — only the
 * per-task overlay (`MandateOverlay`) this plugin contributes grants it, from
 * the row a person set in the task header. The value names the task holding
 * the grant: what every action taken under it records as its authorisation.
 */
export const tasksManageUnowned = defineCapability<{ taskId: string }>({
  id: "tasks.manage-unowned",
  schema: z.object({ taskId: z.string().min(1) }),
  label: "Manage tasks it does not own (a person's grant on its task)",
});
