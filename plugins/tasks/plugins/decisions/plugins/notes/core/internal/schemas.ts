import type { z } from "zod";
import { liveCollection } from "@plugins/network/plugins/live/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { defineExtensionShape } from "@plugins/infra/plugins/entity-extensions/core";

// The `decisions_ext_notes` row: the user's private note on one decision —
// never sent to the agent, and not part of what the decision says (its
// `updated_at` and history ignore it). `server/internal/tables.ts` builds the
// side-table from this shape.
export const decisionNotesShape = defineExtensionShape({
  key: "decisionId",
  fields: { notes: textField() },
  wireTimestamps: ["updatedAt"],
});
export const DecisionNoteSchema = decisionNotesShape.schema;
export type DecisionNote = z.infer<typeof DecisionNoteSchema>;

// The note of ONE decision, read by its `decisionId` — lookup-only (0 or 1
// row per decision, its key the decision), so a reader takes
// `useLive(decisionNoteRows, { id })` and `found: false` is "no note".
// Bounded by construction: only a shown decision card subscribes, a load is
// one primary-key seek, and the `:rows` point routing sends an upsert /
// delete to the one decision's tuple.
export const decisionNoteRows = liveCollection("decision-notes", {
  from: decisionNotesShape,
  id: "decisionId",
});
