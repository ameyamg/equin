import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ScratchProfile } from "@plugins/conversations/plugins/workspace/server";
import { decisionAskProfile } from "./internal/profile";

export default {
  description:
    "A decision's side chat, desktop-only half: the tasks.decisions.ask scratch profile — a fresh agent with its own CLAUDE.md (the decision chat's Instructions setting) importing context.md, written at each launch: the decision in full, the asking conversation's transcript paths, the asking agent's task tree and where to look next (outcome reports, other conversations, the user's note). Read / Grep / Glob and Bash in Claude Code's sandbox (reads anywhere, writes only inside its dir, no network), no file edits; read-only MCP tools only (read_decision, query_db, transcript_paths, get_timeline, read_page) — no task filing, no messaging, no exit_clean, so the thread stays repliable.",
  register: [ScratchProfile.define(decisionAskProfile)],
} satisfies MachinePluginDefinition;
