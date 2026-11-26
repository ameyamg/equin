import { z } from "zod";
import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";

export const upsertDecisionNote = defineEndpoint({
  route: "PUT /api/decision-notes/:decisionId",
  body: z.object({ notes: z.string().min(1) }),
});

export const deleteDecisionNote = defineEndpoint({
  route: "DELETE /api/decision-notes/:decisionId",
});
