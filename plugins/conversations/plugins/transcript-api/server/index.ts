import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { handleTranscript } from "./internal/handle-transcript";
import { transcriptPathsTool } from "./internal/tool";
import { getConversationTranscript } from "../shared/endpoints";

export default {
  description:
    "Agent API: GET /api/conversations/:id/transcript returns the ordered on-disk JSONL paths of a conversation's Claude session chain, and the transcript_paths MCP tool answers the same for an agent (any conversation, read-only) — the one a sandboxed agent, with no network, can reach.",
  httpRoutes: {
    [getConversationTranscript.route]: handleTranscript,
  },
  register: [transcriptPathsTool],
} satisfies ServerPluginDefinition;
