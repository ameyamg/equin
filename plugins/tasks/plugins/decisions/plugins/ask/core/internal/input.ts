import { z } from "zod";

/**
 * What a side chat is launched with: the decision it is about. Everything
 * else (the decision in full, the asking agent's tree, its transcripts) is
 * read at launch by the profile's `prepare`, so the context is the decision as
 * it stands when the chat starts.
 */
export const DecisionAskInputSchema = z.object({
  decisionId: z.string().min(1),
});
export type DecisionAskInput = z.infer<typeof DecisionAskInputSchema>;
