import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { handoffTool } from "./internal/tool";

export default {
  description:
    "The handoff MCP tool of a supervisor role session (gated on the role capability): closes the session through exit_clean's path (push-and-exit's requestCleanExit — refused while an exit precondition fails) and records a note for the role's next session, which sessions' launch takes into its brief after the role's prompt.",
  register: [handoffTool],
} satisfies ServerPluginDefinition;
