import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";
import { z } from "zod";
import { PromptMarkdownSchema } from "@plugins/primitives/plugins/text-editor/core";
import { turnIdKind } from "@plugins/conversations/plugins/turn-ledger/core";

export const AnswerAskUserQuestionBodySchema = z.object({
  /** The serialized answer — the user's own text in it written in the prompt field. */
  text: PromptMarkdownSchema.check(z.minLength(1)),
  /** The answer's ledger id, minted by the client; minted by the server when absent. */
  turnId: turnIdKind.schema.optional(),
});

export const answerAskUserQuestion = defineEndpoint({
  route: "POST /api/conversations/:id/answer-question",
  body: AnswerAskUserQuestionBodySchema,
  response: z.object({ turnId: z.string() }),
  needsMachine: { feature: "Answering an agent's question" },
});
