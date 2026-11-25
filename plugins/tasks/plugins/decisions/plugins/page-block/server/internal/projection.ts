import { formatTagLine } from "@plugins/page/plugins/editor/core";
import type {
  BlockProjected,
  BlockReader,
} from "@plugins/page/plugins/editor/server";
import { getConversation } from "@plugins/tasks/plugins/tasks-core/server";
import { taskIdKind, type TaskId } from "@plugins/tasks/plugins/task-ids/core";
import { DECISION_TAB_OPTIONS } from "@plugins/tasks/plugins/decisions/core";
import {
  readTaskDecisionsInFull,
  type FullDecision,
  type FullExchange,
  type TaskDecisionsRead,
} from "@plugins/tasks/plugins/decisions/server";
import { taskDecisionsBlock } from "../../core";

/** A UTC instant to the minute, as `<page-meta>` spells its times. */
function minute(at: Date): string {
  return `${at.toISOString().slice(0, 16)}Z`;
}

/** `4 open, 3 closed` — the owner's stub. */
export function ownCounts(decisions: readonly FullDecision[]): string {
  const closed = decisions.filter((d) => d.state === "closed").length;
  return `${decisions.length - closed} open, ${closed} closed`;
}

/** One exchange as one self-closing line: who wrote what, when. */
function exchangeLine(e: FullExchange): string {
  const attrs: Record<string, string> = {
    kind: e.kind,
    at: minute(e.createdAt),
  };
  if (e.pick !== null) attrs.pick = e.pick;
  if (e.userText !== null) attrs.user = e.userText;
  if (e.agentText !== null) attrs.agent = e.agentText;
  return formatTagLine("exchange", attrs, true);
}

/**
 * One decision in full, as the lines of a `<task-decisions>` body: a
 * `<decision …>` line carrying what it is and where it stands, then its body
 * QUOTED (`> ` per line — the body is the agent's markdown, and a derived
 * body must be inert to every scanner of the page: a fence or a closing tag
 * in it would otherwise change the document around it), its options, its
 * thread, and the closing line.
 */
export function decisionLines(d: FullDecision): string[] {
  const attrs: Record<string, string> = {
    id: d.id,
    label: d.label,
    state: d.state === "other" ? `other: ${d.stateLabel ?? ""}` : d.state,
    where: DECISION_TAB_OPTIONS[d.tab].label,
    opened: minute(d.openedAt),
    question: d.question,
  };
  if (d.fromDecisionId !== null) attrs.from = d.fromDecisionId;
  if (d.outcome !== null) attrs.outcome = d.outcome;
  if (d.closedAt !== null) attrs.closed = minute(d.closedAt);
  const lines = [formatTagLine("decision", attrs, false)];
  // The body is free text: split on every line terminator the parser knows
  // (`\r\n`, `\r`, `\n`), so no quoted line can carry one.
  const body = d.body.replace(/\r\n?/g, "\n").trimEnd();
  if (body.trim() !== "")
    for (const line of body.split("\n"))
      lines.push(line.trim() === "" ? ">" : `> ${line}`);
  // Options as attribute-quoted lines: a key or a text is free text too.
  for (const o of d.options)
    lines.push(
      formatTagLine(
        "option",
        {
          key: o.key,
          text: o.text,
          ...(o.recommended ? { recommended: "true" } : {}),
        },
        true,
      ),
    );
  for (const e of d.exchanges) lines.push(exchangeLine(e));
  lines.push("</decision>");
  return lines;
}

/** The task of the conversation reading — a reader is a real conversation. */
async function readerTaskOf(conversationId: string): Promise<string | null> {
  const conversation = await getConversation(conversationId);
  if (conversation === null)
    throw new Error(
      `task-decisions: the reading conversation ${conversationId} does not exist`,
    );
  return conversation.taskId ?? null;
}

/** What one block says to one reader, given its task's read. */
export function projectTaskDecisions(
  read: TaskDecisionsRead,
  isOwner: boolean,
): BlockProjected {
  if (!read.exists) return { attrs: { missing: "task deleted" } };
  const attrs = { title: read.title };
  // The owner already has every decision: its tool results, the answer turns
  // and `list_decisions`. A full copy would only cost it context.
  if (isOwner) return { attrs: { ...attrs, own: ownCounts(read.decisions) } };
  return { attrs, body: read.decisions.flatMap(decisionLines) };
}

/**
 * The `Editor.BlockProjection` of `<task-decisions>`: per block, the task's
 * title, then — to the agent whose task it is — a stub counting its
 * decisions, and to any other reader every decision in full.
 */
export async function projectTaskDecisionsBlocks(
  rows: readonly { id: string; type: string; data: unknown }[],
  reader: BlockReader | undefined,
): Promise<ReadonlyMap<string, BlockProjected>> {
  const blocks = rows
    .map((r) => ({ id: r.id, taskId: taskDecisionsBlock.parse(r.data).taskId }))
    // A block still asking which task it shows has nothing to project.
    .filter((b) => b.taskId !== "");
  const out = new Map<string, BlockProjected>();
  if (blocks.length === 0) return out;
  const reads = await readTaskDecisionsInFull(
    blocks.map((b) => taskIdKind.parse(b.taskId)),
  );
  const readerTask =
    reader === undefined ? null : await readerTaskOf(reader.conversationId);
  for (const b of blocks) {
    const read = reads.get(b.taskId as TaskId);
    if (read === undefined)
      throw new Error(`task-decisions: task ${b.taskId} was not read`);
    out.set(b.id, projectTaskDecisions(read, readerTask === b.taskId));
  }
  return out;
}
