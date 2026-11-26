import { z } from "zod";
import { Mcp } from "@plugins/infra/plugins/mcp/server";
import { getConversationClaudeSessionId } from "@plugins/tasks/plugins/tasks-core/server";
import { resolveConversationTranscriptPaths } from "@plugins/conversations/plugins/transcript-watcher/server";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/**
 * `transcript_paths`: the MCP twin of `GET /api/conversations/:id/transcript`,
 * for an agent that cannot reach the HTTP API (a sandboxed one has no
 * network). Read-only, any conversation.
 */
export const transcriptPathsTool = Mcp.tool({
  name: "transcript_paths",
  description:
    "The on-disk transcript files of any conversation (`conv-…`), oldest first: Claude Code JSONL, one event per line. A conversation can span several session files — read them in order and dedup events by `uuid` (first wins). They are long: search them (`rg`, `jq`) rather than reading whole. Read-only.",
  inputSchema: {
    conversation: z.string().min(1).describe('The conversation id ("conv-…").'),
  },
  async handler({ conversation }) {
    const id = conversation.trim();
    const sessionId = await getConversationClaudeSessionId(id);
    if (sessionId === undefined) return text(`${id} names no conversation.`);
    const paths = await resolveConversationTranscriptPaths(id);
    if (paths.length === 0) return text(`${id} has no transcript on disk yet.`);
    return text(paths.join("\n"));
  },
});
