import { implement } from "@plugins/infra/plugins/endpoints/server";
import { deleteDecisionNote, upsertDecisionNote } from "../../shared";
import { decisionNotes } from "./tables";

export const handleUpsertDecisionNote = implement(
  upsertDecisionNote,
  async ({ params, body }) => {
    await decisionNotes.upsert(params.decisionId, { notes: body.notes });
  },
);

export const handleDeleteDecisionNote = implement(
  deleteDecisionNote,
  async ({ params }) => {
    await decisionNotes.delete(params.decisionId);
  },
);
