import { DECISION_TAB_OPTIONS } from "../../core";
import type { ListedDecision } from "./repo";

/** `list_decisions`' answer. */
export function renderDecisionList(
  rows: readonly ListedDecision[],
  { hiddenClosed }: { hiddenClosed: number },
): string {
  const lines = rows.map(renderLine);
  if (hiddenClosed > 0)
    lines.push(`+${hiddenClosed} closed (pass \`all: true\` to list them).`);
  if (lines.length === 0) return "Your task has no decisions.";
  return lines.join("\n");
}

function renderLine(d: ListedDecision): string {
  const state = d.state === "other" ? `other: ${d.stateLabel}` : d.state;
  const where = DECISION_TAB_OPTIONS[d.tab].label;
  const head = `${d.label} (${d.id}) · ${state} · ${where} — ${d.question}`;
  const parts = [head];
  if (d.outcome !== null) parts.push(`outcome: ${d.outcome}`);
  if (d.pendingQuestions > 0)
    parts.push(
      `${d.pendingQuestions} question${d.pendingQuestions === 1 ? "" : "s"} waiting for your reply`,
    );
  const u = d.lastFromUser;
  if (u !== null) {
    const what =
      u.kind === "answer"
        ? `picked ${u.pick}`
        : u.kind === "recorded"
          ? u.pick !== null
            ? `chose ${u.pick} (kept, not sent)`
            : "left a note (kept, not sent)"
          : "asked";
    parts.push(`user last ${what}${u.text ? `: "${u.text}"` : ""}`);
  }
  return parts.join(" · ");
}
