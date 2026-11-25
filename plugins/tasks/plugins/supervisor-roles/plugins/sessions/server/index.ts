import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { adoptBacklogTask, launchRoleSession } from "../core";
import {
  handleAdoptBacklogTask,
  handleLaunchRoleSession,
} from "./internal/launch";
import { adoptTaskTool, backlogTool, routeTaskTool } from "./internal/tools";
import { Trigger } from "@plugins/infra/plugins/events/server";
import { taskStatusChanged } from "@plugins/tasks/plugins/tasks-core/server";
import { handoffLaunchJob } from "./internal/handoff";

export { openRoleSession } from "./internal/launch";
export { recordHandoff } from "./internal/handoff";

export default {
  description:
    "Supervisor role sessions: POST /api/supervisor-roles/:id/sessions opens the role's live session or launches one (one live session per role — a root task stating the supervisor-role mandate, owned by the role, its brief the role's prompt, armed at once), POST …/:id/backlog/:taskId/adopt (the Supervisors pane's Adopt: into the live session, launching one when none is live), and the role powers' MCP tools, gated on the role capability: backlog (list the role's backlog), adopt_task (move a backlog task under the live session's root, wired after any `after` tasks in the same transaction, then armed unless start is manual) and route_task (hand a task the role owns to another role). Hand-offs (the handoff tool is the handoff child's): supervisor_session_handoffs holds a session's note for the next one (recordHandoff), taken by the role's next launch whichever path launches it — the role's prompt then the note as its brief, the ended session's open tasks moved under the new root — and the supervisor-roles.handoff-launch job launches that session once the ending root settles.",
  httpRoutes: {
    [launchRoleSession.route]: handleLaunchRoleSession,
    [adoptBacklogTask.route]: handleAdoptBacklogTask,
  },
  contributions: [
    Trigger({
      on: taskStatusChanged,
      do: handoffLaunchJob,
      with: {},
      oneShot: false,
    }),
  ],
  register: [backlogTool, adoptTaskTool, routeTaskTool, handoffLaunchJob],
} satisfies ServerPluginDefinition;
