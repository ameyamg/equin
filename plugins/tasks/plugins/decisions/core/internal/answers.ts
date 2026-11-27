import { z } from "zod";
import { cappedList } from "@plugins/packages/plugins/list-bound/core";
import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";
import { PromptMarkdownSchema } from "@plugins/primitives/plugins/text-editor/core";

/** The most answers one Submit carries. */
export const ANSWERS_PER_SUBMIT_MAX = 200;
/**
 * The longest note the user may send with an answer, or as a question. The
 * note is written in the standard prompt field, so it carries what a prompt
 * does: a `<ui-context>` chip alone is ~1.5 KB of markup, and attachment refs
 * are markdown — room for a few of those beside the words.
 */
export const ANSWER_NOTE_MAX = 16_000;

/**
 * One drafted answer, as Submit sends it:
 *
 * - `pick` (+ an optional `note`) — the user's choice: delivered to the agent,
 *   the decision Sent until the agent acts on it;
 * - `note` alone — a question: delivered, the decision stays the user's
 *   (Needs you) until the agent replies with `update_decision({ reply })`;
 * - `close` — settle it without telling the agent: "Got it" on an FYI, or a
 *   decision whose agent has finished (a note with it is kept on the record,
 *   not sent).
 */
export const DecisionAnswerSchema = z.object({
  decision: z.string().min(1),
  pick: z.string().min(1).max(8).optional(),
  /** Written in the prompt field (`PromptMarkdown`): a plain field's text does not compile here. */
  note: PromptMarkdownSchema.check(z.maxLength(ANSWER_NOTE_MAX)).optional(),
  close: z.literal(true).optional(),
});
export type DecisionAnswer = z.infer<typeof DecisionAnswerSchema>;

export const SubmitAnswersBodySchema = z.object({
  /** One per Submit press: a retried request delivers nothing twice. */
  submissionId: z.string().uuid(),
  answers: cappedList(DecisionAnswerSchema, { max: ANSWERS_PER_SUBMIT_MAX }),
});
export type SubmitAnswersBody = z.infer<typeof SubmitAnswersBodySchema>;

/** Why one answer of a batch was not taken; its draft stays, showing why. */
export const ANSWER_REFUSALS = [
  "unknown-decision",
  "closed",
  "already-sent",
  "empty",
  "unknown-pick",
  "close-not-allowed",
  "no-agent",
  "resume-blocked",
  "too-many-exchanges",
  "delivery-failed",
] as const;
export type AnswerRefusalReason = (typeof ANSWER_REFUSALS)[number];

export const SubmitAnswersResponseSchema = z.object({
  /** One event turn per agent, carrying all of its answers. */
  delivered: cappedList(
    z.object({
      taskId: z.string(),
      /** The conversation it was typed into; `null` when typing failed (`typingFailed`). */
      conversationId: z.string().nullable(),
      turnId: z.string(),
      decisions: cappedList(z.string(), { max: ANSWERS_PER_SUBMIT_MAX }),
      /**
       * The answers are recorded (the decisions read Sent) but typing the
       * turn into the agent failed — its ledger row is `failed`, retried from
       * the conversation. `null` when it was typed (or held while starting).
       */
      typingFailed: z.string().nullable(),
    }),
    { max: ANSWERS_PER_SUBMIT_MAX },
  ),
  /** Kept on the record, not sent: the agent had finished, or the user closed it. */
  recorded: cappedList(z.string(), { max: ANSWERS_PER_SUBMIT_MAX }),
  refused: cappedList(
    z.object({
      decision: z.string(),
      reason: z.enum(ANSWER_REFUSALS),
      message: z.string(),
    }),
    { max: ANSWERS_PER_SUBMIT_MAX },
  ),
});
export type SubmitAnswersResponse = z.infer<typeof SubmitAnswersResponseSchema>;

/**
 * The user's batch of answers: each agent gets ONE event turn naming all of
 * its answers; an answer to a finished agent is kept on the record instead
 * (never reopening it). A batch with partial outcomes, answered as data.
 */
export const submitDecisionAnswersEndpoint = defineEndpoint({
  route: "POST /api/decisions/answers",
  body: SubmitAnswersBodySchema,
  response: SubmitAnswersResponseSchema,
  // Delivery types into agents (conversations), the desktop's: served by
  // `decisions/machine`, every client handles "not available".
  needsMachine: { feature: "Answering agents' decisions" },
});
