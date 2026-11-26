import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineScratchProfile } from "@plugins/conversations/plugins/workspace/server";
import { getConfig } from "@plugins/config_v2/server";
import { getMainRepoRoot } from "@plugins/infra/plugins/spawn/core";
import { renderPrompt } from "@plugins/packages/plugins/prompt-template/core";
import {
  DECISION_ASK_CONTEXT_FILE,
  DECISION_ASK_PROFILE,
  DecisionAskInputSchema,
  decisionAskConfig,
  type DecisionAskInput,
} from "../../core";
import { readDecisionAskContext, renderDecisionAskContext } from "./context";

/**
 * The agent's CLAUDE.md: the Instructions setting, filled. A variable it names
 * that is not filled here fails the launch, never a prompt with a hole.
 */
function instructions(input: DecisionAskInput): string {
  const rendered = renderPrompt(getConfig(decisionAskConfig).instructions, {
    decisionId: input.decisionId,
    contextFile: DECISION_ASK_CONTEXT_FILE,
  });
  if (!rendered.ok)
    throw new Error(
      `[decisions.ask] the decision chat's instructions (Settings → Config) name unknown variables: ${rendered.unknown.map((n) => `{{${n}}}`).join(", ")}`,
    );
  return rendered.text;
}

/**
 * A decision's side chat: a fresh agent helping the user decide, in a scratch
 * directory. Its CLAUDE.md is its own (never the asking agent's or a
 * supervisor's instructions) and imports `context.md`, written at launch: the
 * decision in full, the asking conversation's transcript paths, the asking
 * agent's task tree and where to look next. It reads anything — Read / Grep /
 * Glob, and Bash in Claude Code's sandbox (`sandbox: true`: commands write
 * only inside the scratch dir and reach no network, so nothing outside it can
 * change, nothing can be pushed) — and edits no file (Write / Edit denied; the
 * session runs in bypass mode, so `deny` is what removes a tool). Its MCP
 * tools are read-only lookups: no `add_task`, no `message_agent`, no page
 * writes, no `exit_clean` — it ends its turn so the user can reply.
 */
export const decisionAskProfile = defineScratchProfile({
  id: DECISION_ASK_PROFILE,
  label: "Ask about a decision",
  description:
    "A decision's side chat: a read-only agent helping the user decide, given the decision, the asking agent's task tree and its transcripts; it changes nothing.",
  inputSchema: DecisionAskInputSchema,
  instructions,
  mcpTools: [
    "read_decision",
    "query_db",
    "transcript_paths",
    "get_timeline",
    "read_page",
  ],
  permissions: {
    allow: ["Read", "Grep", "Glob", "Bash"],
    deny: ["Write", "Edit", "NotebookEdit"],
  },
  sandbox: true,
  prepare: async ({ dir, input }) => {
    const context = await readDecisionAskContext(
      input.decisionId,
      await getMainRepoRoot(),
    );
    await writeFile(
      join(dir, DECISION_ASK_CONTEXT_FILE),
      renderDecisionAskContext(context),
    );
  },
});
