import { formatTagLine } from "@plugins/page/plugins/editor/core";
import { DECISION_TAB_OPTIONS } from "../../core";
import type { FullDecision, FullExchange } from "./full-read";

/** A UTC instant to the minute, as `<page-meta>` spells its times. */
export function minute(at: Date): string {
  return `${at.toISOString().slice(0, 16)}Z`;
}

/** A decision's state in words: `other` carries its own. */
export function stateWord(
  d: Pick<FullDecision, "state" | "stateLabel">,
): string {
  return d.state === "other" ? `other: ${d.stateLabel ?? ""}` : d.state;
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

/** What a `<decision …>` line says about a decision: what it is, where it stands. */
export function decisionAttrs(d: FullDecision): Record<string, string> {
  const attrs: Record<string, string> = {
    id: d.id,
    label: d.label,
    state: stateWord(d),
    where: DECISION_TAB_OPTIONS[d.tab].label,
    opened: minute(d.openedAt),
    question: d.question,
  };
  if (d.fromDecisionId !== null) attrs.from = d.fromDecisionId;
  if (d.outcome !== null) attrs.outcome = d.outcome;
  if (d.closedAt !== null) attrs.closed = minute(d.closedAt);
  return attrs;
}

/**
 * `body` as quoted lines (`> ` per line — the body is the agent's markdown,
 * and a quoted line is inert to every scanner of a page: a fence or a closing
 * tag in it would otherwise change the document around it). Split on every
 * line terminator the parser knows (`\r\n`, `\r`, `\n`), so no quoted line can
 * carry one.
 */
export function quotedLines(body: string): string[] {
  const text = body.replace(/\r\n?/g, "\n").trimEnd();
  if (text.trim() === "") return [];
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`));
}

/** A decision's options as attribute-quoted lines: a key or a text is free text. */
export function optionLines(d: FullDecision): string[] {
  return d.options.map((o) =>
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
}

/**
 * One decision in full: a `<decision …>` line, its body quoted, its options,
 * its thread, and the closing line — what `read_decision` answers, in the
 * same lines a `<task-decisions>` block's projection excerpts.
 */
export function decisionLines(d: FullDecision): string[] {
  return [
    formatTagLine("decision", decisionAttrs(d), false),
    ...quotedLines(d.body),
    ...optionLines(d),
    ...d.exchanges.map(exchangeLine),
    "</decision>",
  ];
}
