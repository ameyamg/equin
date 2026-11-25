import { formatTagLine } from "@plugins/page/plugins/editor/core";
import type {
  BlockProjected,
  BlockReader,
} from "@plugins/page/plugins/editor/server";
import { getConversation } from "@plugins/tasks/plugins/tasks-core/server";
import { taskIdKind, type TaskId } from "@plugins/tasks/plugins/task-ids/core";
import { DECISION_TABS } from "@plugins/tasks/plugins/decisions/core";
import {
  decisionAttrs,
  optionLines,
  quotedLines,
  readTaskDecisionsInFull,
  type FullDecision,
  type TaskDecisionsRead,
} from "@plugins/tasks/plugins/decisions/server";
import { taskDecisionsBlock } from "../../core";

/**
 * The projection's bounds, chosen from the hand-written D-items it replaces
 * (312 of them on 22 supervisor pages, 2026-11-25: a median of ~400 chars, p90
 * ~1.3k, max 31k; 12 per page median, 39 max):
 *
 * - an open decision's body is cut to BODY_EXCERPT_CHARS (one flattened
 *   line: the gist of a median one, never its whole worst case);
 * - open decisions are shown that way, most pressing first (needs you, sent,
 *   FYI; then the oldest), while they fit in DETAIL_CHARS — ~8–10 of a typical
 *   size, never fewer than two (one is at most ~3.3k: a 300-char question, a
 *   cut body, 8 options of 240);
 * - the RECENT_CLOSED latest closed ones as one line each, their question cut
 *   to QUESTION_EXCERPT_CHARS and outcome to OUTCOME_EXCERPT_CHARS;
 * - every other decision as an index line (id, label, state), so each id is
 *   on the page: `read_decision` returns any one in full.
 *
 * A block at the record's caps (200 decisions, 20k bodies, full threads,
 * every field at its maximum) so stays under 30k chars (projection.test.ts),
 * where it was ~330M in full; 200 decisions with short labels, ~20k.
 */
export const BODY_EXCERPT_CHARS = 240;
export const DETAIL_CHARS = 8_000;
export const RECENT_CLOSED = 5;
export const OUTCOME_EXCERPT_CHARS = 200;
export const QUESTION_EXCERPT_CHARS = 120;

/** What the block says on how to read past the excerpts. */
export const FULL_READ_HINT =
  "excerpts — read_decision with a decision's id returns it in full";

/** `text` flattened to one line, cut at a word to at most `max` chars + `…`. */
export function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** `4 open, 3 closed`. */
export function ownCounts(decisions: readonly FullDecision[]): string {
  const closed = decisions.filter((d) => d.state === "closed").length;
  return `${decisions.length - closed} open, ${closed} closed`;
}

/**
 * An open decision as the block shows it: its `<decision …>` line (with how
 * long its thread is), its body cut to an excerpt and quoted, its options.
 */
export function openDecisionLines(d: FullDecision): string[] {
  const attrs = decisionAttrs(d);
  if (d.exchanges.length > 0) attrs.thread = String(d.exchanges.length);
  const body = excerpt(d.body, BODY_EXCERPT_CHARS);
  return [
    formatTagLine("decision", attrs, false),
    ...quotedLines(body),
    ...optionLines(d),
    "</decision>",
  ];
}

/** A closed decision as one line, its question and outcome cut. */
export function closedDecisionLine(d: FullDecision): string {
  const attrs = decisionAttrs(d);
  attrs.question = excerpt(d.question, QUESTION_EXCERPT_CHARS);
  if (d.outcome !== null)
    attrs.outcome = excerpt(d.outcome, OUTCOME_EXCERPT_CHARS);
  return formatTagLine("decision", attrs, true);
}

/**
 * A decision named only — enough to read it with `read_decision`: its state
 * is the bare word (an `other` one's own word is in the full read).
 */
export function indexLine(d: FullDecision): string {
  return formatTagLine(
    "decision",
    { id: d.id, label: d.label, state: d.state },
    true,
  );
}

const tabRank = new Map<string, number>(DECISION_TABS.map((t, i) => [t, i]));
const byPressing = (a: FullDecision, b: FullDecision) =>
  (tabRank.get(a.tab) ?? 0) - (tabRank.get(b.tab) ?? 0) ||
  a.openedAt.getTime() - b.openedAt.getTime();
const byLatestClosed = (a: FullDecision, b: FullDecision) =>
  (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0);

const charsOf = (lines: readonly string[]) =>
  lines.reduce((n, l) => n + l.length + 1, 0);

/**
 * A task's decisions as the block's body, bounded by construction (the bounds
 * above): open ones as excerpts while they fit, the latest closed as lines,
 * every other one as an index line.
 */
export function decisionsBody(decisions: readonly FullDecision[]): string[] {
  const open = decisions.filter((d) => d.state !== "closed").sort(byPressing);
  const closed = decisions
    .filter((d) => d.state === "closed")
    .sort(byLatestClosed);
  const lines: string[] = [];
  const rest: FullDecision[] = [];
  let used = 0;
  for (const d of open) {
    const shown = openDecisionLines(d);
    const cost = charsOf(shown);
    if (rest.length === 0 && used + cost <= DETAIL_CHARS) {
      lines.push(...shown);
      used += cost;
    } else rest.push(d);
  }
  lines.push(...closed.slice(0, RECENT_CLOSED).map(closedDecisionLine));
  rest.push(...closed.slice(RECENT_CLOSED));
  lines.push(...rest.map(indexLine));
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
  // and `list_decisions`. A copy would only cost it context.
  if (isOwner) return { attrs: { ...attrs, own: ownCounts(read.decisions) } };
  if (read.decisions.length === 0)
    return { attrs: { ...attrs, decisions: "none" } };
  return {
    attrs: {
      ...attrs,
      decisions: ownCounts(read.decisions),
      shown: FULL_READ_HINT,
    },
    body: decisionsBody(read.decisions),
  };
}

/**
 * The `Editor.BlockProjection` of `<task-decisions>`: per block, the task's
 * title, then — to the agent whose task it is — a stub counting its
 * decisions, and to any other reader its decisions bounded
 * ({@link decisionsBody}), each one's id readable in full by `read_decision`.
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
