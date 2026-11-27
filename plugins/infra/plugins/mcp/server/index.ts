import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ConfigV2 } from "@plugins/config_v2/server";
import { listedToolsRetention } from "./internal/listed";
import { mcpPromptsConfig } from "../core";

export { Mcp } from "./internal/mcp";
export { toolCallableBy, type ToolReach } from "./internal/listed";
export type {
  McpCallerContext,
  McpConversationTool,
  McpUnattachedTool,
  McpScope,
  McpScopeResolver,
  McpTool,
  McpToolCallContext,
  McpToolContext,
  McpToolResult,
  McpToolRegistration,
} from "./internal/mcp";

export default {
  description:
    "The MCP contribution API, SDK-free: Mcp.tool / Mcp.scope register a tool or THE scope resolver (no server instructions: context about an agent is a conversations/system-prompt section) into the in-process registry the desktop half (machine/) serves over HTTP — so a plugin contributing to the MCP server stays portable. Registers the agent-instructions config (the hint appended to a tool's refusal). Owns mcp_listed_tools (the tools last listed to each conversation — what its client holds) and toolCallableBy(conversationId, toolRegistration): whether a conversation's agent can call a tool now (listed to it and its when still true), or why not.",
  register: [listedToolsRetention],
  contributions: [ConfigV2.Register({ descriptor: mcpPromptsConfig })],
} satisfies ServerPluginDefinition;
