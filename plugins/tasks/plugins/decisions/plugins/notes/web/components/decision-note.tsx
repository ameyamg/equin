import { useCallback, type ReactElement } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import { useFetchEndpoint } from "@plugins/infra/plugins/endpoints/web";
import {
  SideNoteArea,
  SideNoteToggle,
} from "@plugins/primitives/plugins/side-note/web";
import type { DecisionRow } from "@plugins/tasks/plugins/decisions/core";
import { decisionNoteRows } from "../../core";
import { deleteDecisionNote, upsertDecisionNote } from "../../shared";

const subjectOf = (decisionId: string): string => `decision:${decisionId}`;

/** The decision's private note, above its answer box. */
export function DecisionNoteArea({
  decision,
}: {
  decision: DecisionRow;
}): ReactElement | null {
  const decisionId = decision.id;
  const fetchEndpoint = useFetchEndpoint();
  const read = useLive(decisionNoteRows, { id: decisionId });
  const save = useCallback(
    async (next: string) => {
      if (next.trim() === "")
        await fetchEndpoint(deleteDecisionNote, { decisionId });
      else
        await fetchEndpoint(
          upsertDecisionNote,
          { decisionId },
          { body: { notes: next } },
        );
    },
    [decisionId, fetchEndpoint],
  );
  return (
    <SideNoteArea
      subject={subjectOf(decisionId)}
      read={read}
      save={save}
      keepField="decision-notes.note"
      ariaLabel="Your private note on this decision"
    />
  );
}

/** The note icon, on the right of the answer's editor. */
export function DecisionNoteToggle({
  decision,
}: {
  decision: DecisionRow;
}): ReactElement | null {
  const read = useLive(decisionNoteRows, { id: decision.id });
  return <SideNoteToggle subject={subjectOf(decision.id)} read={read} />;
}
