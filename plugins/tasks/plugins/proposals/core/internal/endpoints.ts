import { z } from "zod";
import {
  byteStream,
  defineEndpoint,
} from "@plugins/infra/plugins/endpoints/core";
import { ATTACHMENT_MAX_BYTES } from "@plugins/infra/plugins/attachments/core";
import { cappedList } from "@plugins/packages/plugins/list-bound/core";
import {
  PROPOSAL_STATES,
  ProposalTypeIdSchema,
  ProposalValuesSchema,
} from "./fields";

/** The most records one `./equin propose` hands over. */
export const PROPOSALS_PER_SEND_MAX = 50;
/** The most attachments one proposal's values reference. */
export const PROPOSAL_ATTACHMENTS_MAX = 100;
/** A proposal's note, or a decision's. */
export const PROPOSAL_NOTE_MAX = 4000;

const NoteSchema = z.string().max(PROPOSAL_NOTE_MAX);

/** What became of one record handed to main. */
export const ProposalOutcomeSchema = z.discriminatedUnion("kind", [
  /** Stored as an open proposal; `revision` 2+ superseded the open one. */
  z.object({
    kind: z.literal("proposed"),
    id: z.string(),
    revision: z.number().int(),
    changed: cappedList(z.string(), { max: 64 }),
  }),
  /** The record is the same as main's: nothing was stored. */
  z.object({ kind: z.literal("unchanged") }),
  /**
   * The same values as this task's latest proposal of the record, which the
   * user already decided: nothing was stored (edit it again to propose anew).
   */
  z.object({
    kind: z.literal("decided"),
    id: z.string(),
    state: z.enum(PROPOSAL_STATES),
  }),
  /** Not stored — why, in words (an unknown type, values its fields refuse). */
  z.object({ kind: z.literal("refused"), message: z.string() }),
]);
export type ProposalOutcome = z.infer<typeof ProposalOutcomeSchema>;

/**
 * `POST /api/proposals/send` — on an agent's WORKTREE: hand every record of a
 * registered type this worktree's database wrote since it was forked from
 * main's (or only `only`) to main as proposals. Called by `./equin propose`.
 */
export const sendProposals = defineEndpoint({
  route: "POST /api/proposals/send",
  internal: {
    why: "`./equin propose` calls it on its own worktree's backend; no page does",
  },
  body: z.object({
    conversationId: z.string().min(1),
    note: NoteSchema.min(1),
    only: cappedList(
      z.object({ type: ProposalTypeIdSchema, id: z.string().min(1) }),
      { max: PROPOSALS_PER_SEND_MAX },
    ).optional(),
  }),
  response: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("sent"),
      results: cappedList(
        z.object({
          type: z.string(),
          recordId: z.string(),
          outcome: ProposalOutcomeSchema,
        }),
        { max: PROPOSALS_PER_SEND_MAX },
      ),
    }),
    /** Nothing was sent: this is main, or not a fork. */
    z.object({ kind: z.literal("refused"), message: z.string() }),
  ]),
});

/**
 * `POST /api/proposals/incoming` — on MAIN: one record as an agent's worktree
 * proposes it. Main diffs it against its own record, stores an open proposal
 * (superseding the task's open one for the same record) and links the files
 * it references, which must already be here (`importProposalAttachment`).
 */
export const receiveProposal = defineEndpoint({
  route: "POST /api/proposals/incoming",
  internal: { why: "a worktree's backend posts it to main's; no page does" },
  agentWrite: "proposal",
  body: z.object({
    type: ProposalTypeIdSchema,
    scope: z.string().min(1),
    recordId: z.string().min(1),
    values: ProposalValuesSchema,
    note: NoteSchema.min(1),
    conversationId: z.string().min(1),
    worktree: z.string().min(1),
    /** When the worktree's database was forked from main's. */
    forkedAt: z.string().datetime(),
  }),
  response: ProposalOutcomeSchema,
});

/** `POST /api/proposals/attachments/missing` — on MAIN: which of `ids` it lacks. */
export const missingProposalAttachments = defineEndpoint({
  route: "POST /api/proposals/attachments/missing",
  internal: { why: "a worktree's backend asks main before sending files" },
  agentWrite: "proposal",
  body: z.object({
    ids: cappedList(z.string(), { max: PROPOSAL_ATTACHMENTS_MAX }),
  }),
  response: z.object({
    missing: cappedList(z.string(), { max: PROPOSAL_ATTACHMENTS_MAX }),
  }),
});

/**
 * `PUT /api/proposals/attachments/:id` — on MAIN: one file a proposal
 * references, imported under the worktree's own id (one id is one file
 * everywhere). Idempotent: an id already here answers `exists`. Unlinked until
 * the proposal that references it arrives, which links it.
 */
export const importProposalAttachment = defineEndpoint({
  route: "PUT /api/proposals/attachments/:id",
  internal: { why: "a worktree's backend streams a proposal's file to main" },
  agentWrite: "proposal",
  body: byteStream(),
  query: z.object({
    filename: z.string().min(1),
    mime: z.string(),
    size: z.coerce.number().int().positive().max(ATTACHMENT_MAX_BYTES),
  }),
  response: z.object({ kind: z.enum(["imported", "exists"]) }),
});

export const DecideProposalBodySchema = z.discriminatedUnion("decision", [
  /**
   * Apply it — or, with `values`, the user's edited copy: the keys it sets
   * (the proposal's changed keys and the ones the user edited) are written,
   * no other.
   */
  z.object({
    decision: z.literal("accept"),
    values: ProposalValuesSchema.optional(),
  }),
  z.object({ decision: z.literal("reject"), note: NoteSchema.optional() }),
  /** Back to the agent with what should change. */
  z.object({
    decision: z.literal("request-changes"),
    note: NoteSchema.min(1),
  }),
]);
export type DecideProposalBody = z.infer<typeof DecideProposalBodySchema>;

/** How the decision reached the agent that proposed it. */
export const PROPOSAL_DELIVERIES = [
  "delivered",
  "finished",
  "no-agent",
  "blocked",
] as const;
export type ProposalDelivery = (typeof PROPOSAL_DELIVERIES)[number];

/**
 * `POST /api/proposals/:id/decide` — the user's answer (owner only: an agent
 * session cannot accept its own proposal). An accept goes through the record
 * type's own write path; a refusal there keeps the proposal open.
 */
export const decideProposal = defineEndpoint({
  route: "POST /api/proposals/:id/decide",
  body: DecideProposalBodySchema,
  // Served by the machine half: it types the decision into the agent, and an
  // accept runs the owner's write path, which may queue machine work.
  needsMachine: { feature: "Deciding on an agent's proposal" },
  response: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("decided"),
      state: z.enum(PROPOSAL_STATES),
      delivery: z.enum(PROPOSAL_DELIVERIES),
    }),
    /** The owner's write path refused the values: still open. */
    z.object({ kind: z.literal("refused"), message: z.string() }),
    /** Decided already (or replaced by a newer revision). */
    z.object({ kind: z.literal("not-open"), state: z.enum(PROPOSAL_STATES) }),
  ]),
});
