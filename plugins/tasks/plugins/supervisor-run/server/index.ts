import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { TaskLaunchServer } from "@plugins/tasks/plugins/launch-options/server";
import { setMandate } from "@plugins/tasks/plugins/tasks-core/server";
import { supervisorMandate } from "@plugins/tasks/plugins/mandate-presets/core";
import { supervisorLaunchOption } from "../core";
import { mandateEscalateCapability } from "./internal/capability";
import { becomeSupervisorTool } from "./internal/tool";

export default {
  description:
    "The Supervisor launch option's server half: a task filed with it states the supervisor mandate (supervisorMandate) as its own — its conversation an ordinary one with more powers, the tasks it files workers that report. Not inherited: the tasks its agents file are covered by the mandate already (nearest wins). The become_supervisor MCP tool (granted by mandate.escalate, interactive only): the agent running an interactive task switches that task to the supervisor mandate itself, when its scope is too big for one context — change-notice then hands it the supervisor's tools and sections, and the user is notified with its reason.",
  contributions: [
    mandateEscalateCapability,
    TaskLaunchServer({
      def: supervisorLaunchOption,
      apply: async ({ taskId }, supervisor) => {
        if (supervisor) await setMandate(taskId, supervisorMandate);
      },
    }),
  ],
  register: [becomeSupervisorTool],
} satisfies ServerPluginDefinition;
