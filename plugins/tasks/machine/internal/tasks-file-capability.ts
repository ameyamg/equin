import { Mandate } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import {
  tasksFile,
  type TasksFileGrant,
} from "@plugins/tasks/plugins/tasks-core/core";
import type { TaskTrack } from "@plugins/tasks/plugins/task-track/core";
import { getConfig } from "@plugins/config_v2/server";
import { renderConfigPrompt } from "@plugins/config_v2/plugins/prompts/server";
import { taskFilingPromptsConfig } from "../../core";
import { describeFilingGrant } from "./add-task-filing";

// The grant's per-track keys ARE the task tracks (tasks-core cannot import
// task-track): a track added to one side and not the other fails here.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const tracksMatch: Same<
  Exclude<keyof TasksFileGrant, "defaultAfter" | "backlog">,
  TaskTrack
> = true;
void tracksMatch;

/** How a `tasks.file` grant reads to the agent: the user's Task filing
 * instructions, filled with what this grant allows. */
export const tasksFileCapability = Mandate.Capability({
  cap: tasksFile,
  describe: (grant: TasksFileGrant) =>
    renderConfigPrompt(taskFilingPromptsConfig, "mandateLine", {
      grant: describeFilingGrant(grant, getConfig(taskFilingPromptsConfig)),
    }),
});
