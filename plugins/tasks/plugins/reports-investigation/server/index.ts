import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { TaskCategory } from "@plugins/tasks/plugins/task-category/server";
import {
  REPORTS_CATEGORY_ID,
  reportInvestigationHandler,
  reportOwnerHandler,
} from "./internal/register";

export default {
  description:
    "Files reports' investigation tasks: owns the Reports task category and registers the task-creating handler into reports' investigation sink (Investigate) and answers reports' owner question (a linked task owns its report until it is dropped).",
  contributions: [
    TaskCategory({ id: REPORTS_CATEGORY_ID, label: "Reports", order: 4 }),
  ],
  sinkHandlers: [reportInvestigationHandler, reportOwnerHandler],
} satisfies ServerPluginDefinition;
