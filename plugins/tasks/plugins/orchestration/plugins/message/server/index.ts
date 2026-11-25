import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { messageTreeCapability } from "./internal/capability";
import { listAgentsTool, messageAgentTool } from "./internal/tools";

export { latestAgentConversation } from "./internal/agents";
export { deliverEventTurn } from "./internal/deliver";
export type { EventDelivery, EventTurn } from "./internal/deliver";

export default {
  description:
    "Agents messaging agents: message_agent, visible to every agent (an event turn typed into the latest conversation of the task a task id or conversation id names, any task — a working agent reads it at its next step — resuming it first when it stopped; refused to oneself or where no agent ran; a closed one only with reopen, which needs the message.tree grant and a task of the caller's mandate tree), and list_agents, granted by message.tree (every task of the caller's mandate tree an agent ran on, with its latest conversation and how it stands). The capability's describe joins the Mandate section. Names no workflow. deliverEventTurn(taskId, turn) is the one path an event turn takes into a task's agent — its latest conversation, resumed first when stopped, never reopened when closed — for any plugin that answers an agent.",
  contributions: [messageTreeCapability],
  register: [listAgentsTool, messageAgentTool],
} satisfies ServerPluginDefinition;
