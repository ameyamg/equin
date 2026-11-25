import { StatusDot } from "@plugins/primitives/plugins/css/plugins/status-dot/web";
import type { FieldDef } from "@plugins/primitives/plugins/data-view/web";
import type { DecisionRow } from "../../core";
import { decisionPresentation } from "./presentation";
import { isAnswerable, type DecisionDraft } from "./drafts";

type Pill = "decision" | "action" | "fyi" | "other" | "sent" | "closed";

// The server's derived tab says Sent; an `other` decision sits there too but keeps its own state.
const pillOf = (r: DecisionRow): Pill =>
  r.tab === "sent" && r.state !== "other" ? "sent" : r.state;

// The pills with one label each. An `other` decision's pill is its own word
// (`stateLabel`), so it has no option: its row draws its own dot (`cell`).
const PILL_OPTIONS = (
  [
    ["decision", "decision"],
    ["action", "action"],
    ["fyi", "fyi"],
    ["sent", "decision"],
    ["closed", "closed"],
  ] as const
).map(([value, state]) => {
  const p = decisionPresentation({
    state,
    stateLabel: null,
    unconsumedAnswers: value === "sent" ? 1 : 0,
  });
  return { value, label: p.label, variant: p.variant };
});

/**
 * The state pill as a row's leading dot — computed from the state and the
 * thread (an answer not acted on reads Sent), so it is drawn only. Every list
 * of decisions (the inbox, a task's panel) leads with it.
 */
export const decisionPillField: FieldDef<DecisionRow> = {
  id: "pill",
  label: "State",
  type: "enum",
  value: pillOf,
  options: PILL_OPTIONS,
  cell: (r) => {
    const label = decisionPresentation(r).label;
    return (
      <span title={label} aria-label={label}>
        <StatusDot colorClass="bg-muted-foreground" />
      </span>
    );
  },
  sortable: false,
  filterable: false,
  groupable: false,
};

/** What a row's draft says, in words: "Your answer: A + note", "Your question", "Got it". */
export function draftWords(
  r: DecisionRow,
  d: DecisionDraft | undefined,
): string | null {
  if (d === undefined || !isAnswerable(r)) return null;
  const note = d.note.trim() !== "";
  if (d.pick !== null) return `Your answer: ${d.pick}${note ? " + note" : ""}`;
  if (d.close) return r.state === "fyi" ? "Got it" : "Close without answering";
  return note ? "Your question" : null;
}

/** The drafted answer on its row, so what Submit will send is seen in the list. */
export function decisionDraftField(
  drafts: Readonly<Record<string, DecisionDraft>>,
): FieldDef<DecisionRow> {
  return {
    id: "draft",
    label: "Your answer",
    type: "text",
    value: (r) => draftWords(r, drafts[r.id]),
    sortable: false,
    filterable: false,
    groupable: false,
  };
}
