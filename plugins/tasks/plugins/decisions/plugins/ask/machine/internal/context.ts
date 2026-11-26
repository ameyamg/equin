import { eq } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { decisionIdKind } from "@plugins/tasks/plugins/decisions/core";
import {
  _decisions,
  decisionLines,
  readDecisionInFull,
} from "@plugins/tasks/plugins/decisions/server";
import { taskTree } from "@plugins/tasks/plugins/orchestration/plugins/tree-digest/server";
import { resolveConversationTranscriptPaths } from "@plugins/conversations/plugins/transcript-watcher/server";

/** The facts a side chat's context file is written from, read at launch. */
export interface DecisionAskContext {
  decisionId: string;
  /** The decision in full (`read_decision`'s `<decision>` lines). */
  decisionLines: readonly string[];
  taskId: string;
  /** The conversation that opened the decision (no FK: it may be gone). */
  askedBy: string;
  /** Its transcript files, oldest first; empty when none is on disk. */
  transcriptPaths: readonly string[];
  /** The asking agent's mandate subtree; null when the conversation is gone. */
  tree: string | null;
  /** equin's main checkout. */
  checkout: string;
}

/** Reads what a side chat about `decisionId` starts from. Throws for no such decision. */
export async function readDecisionAskContext(
  decisionId: string,
  checkout: string,
): Promise<DecisionAskContext> {
  if (!decisionIdKind.is(decisionId))
    throw new Error(`[decisions.ask] ${decisionId} is not a decision id`);
  const key = decisionIdKind.key(decisionId);
  const [full, [opened]] = await Promise.all([
    readDecisionInFull(key),
    db
      .select({ askedBy: _decisions.openedByConversationId })
      .from(_decisions)
      .where(eq(_decisions.id, key)),
  ]);
  if (full === null || opened === undefined)
    throw new Error(`[decisions.ask] no decision ${decisionId}`);
  const [transcriptPaths, tree] = await Promise.all([
    resolveConversationTranscriptPaths(opened.askedBy),
    taskTree({ conversationId: opened.askedBy }),
  ]);
  return {
    decisionId,
    decisionLines: decisionLines(full),
    taskId: full.taskId,
    askedBy: opened.askedBy,
    transcriptPaths,
    tree,
    checkout,
  };
}

/** The side chat's context file: the decision, where it comes from, where to look. */
export function renderDecisionAskContext(c: DecisionAskContext): string {
  const transcripts =
    c.transcriptPaths.length === 0
      ? "(No transcript on disk for it.)"
      : c.transcriptPaths.map((p) => `- \`${p}\``).join("\n");
  const tree =
    c.tree === null
      ? "(The asking conversation is gone, so its tree is not known: find the task's relatives with `query_db` on `tasks`.)"
      : ["```", c.tree, "```"].join("\n");
  return `## The decision

${c.decisionLines.join("\n")}

It belongs to task \`${c.taskId}\` and was opened by conversation \`${c.askedBy}\`.
The user's own private note on it (never sent to the agent), if any:
\`select notes from decisions_ext_notes where parent_id = '${c.decisionId}'\`.

## The asking conversation's transcript

Its files, oldest first (a conversation can span several sessions; dedup
events by \`uuid\`, first wins):

${transcripts}

## The asking agent's task tree

The tasks the asking agent oversees (its own is marked), as it sees them:

${tree}

## Where to look next

- A task's conversations: \`select id, title, status, created_at from conversations where task_id = '<task-…>' order by created_at\`.
  Then \`transcript_paths\` with a \`conv-…\` id for its files.
- What a worker handed back when it finished its run (its outcome report):
  \`select parent_id as task_id, body, standing, submitted_at from tasks_ext_outcome_report where parent_id in ('<task-…>', …)\`.
  Read these before a worker's transcript: they are its own summary.
- The task's other decisions: \`select id, label, state, question from decisions where task_id = '${c.taskId}'\`, then \`read_decision\`.
- equin's code: the main checkout at \`${c.checkout}\` (read-only).
`;
}
