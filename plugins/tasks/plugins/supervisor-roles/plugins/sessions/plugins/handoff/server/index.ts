import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { handoffTool } from "./internal/tool";
import { decisionsCarry } from "./internal/carry-decisions";

export default {
  description:
    "The handoff MCP tool of a supervisor role session (gated on the role capability): closes the session through exit_clean's path (push-and-exit's requestCleanExit — refused while an exit precondition fails) and records a note for the role's next session, which sessions' launch takes into its brief after the role's prompt; and the decisions carry (SessionHandoff.Carry): the ending session's open decisions move to the new session's root, so the exit check stands aside for them (handedOver).",
  contributions: [decisionsCarry],
  register: [handoffTool],
} satisfies ServerPluginDefinition;
