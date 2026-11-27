import { and, eq, inArray } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { HttpError } from "@plugins/infra/plugins/endpoints/server";
import {
  implementMachine,
  machineHandler,
} from "@plugins/infra/plugins/endpoints/machine";
import { sha256Hex } from "@plugins/packages/plugins/string-hash/core";
import {
  turnIdKind,
  type TurnId,
} from "@plugins/conversations/plugins/turn-ledger/core";
import { deliverEventTurn } from "@plugins/tasks/plugins/orchestration/plugins/message/server";
import {
  EMPTY_PROMPT,
  PromptMarkdownSchema,
  type PromptMarkdown,
} from "@plugins/primitives/plugins/text-editor/core";
import {
  acceptedSet,
  decideProposal,
  proposalIdKind,
  type DecideProposalBody,
  type ProposalDelivery,
  type ProposalState,
} from "../../core";
import { proposalTypeOf } from "../../server/internal/registry";
import { _proposals } from "../../server/internal/tables";
import { resolveValues } from "../../server/internal/values";

type Proposal = typeof _proposals.$inferSelect;

type DecideAnswer =
  | { kind: "decided"; state: ProposalState; delivery: ProposalDelivery }
  | { kind: "refused"; message: string }
  | { kind: "not-open"; state: ProposalState };

/** The states the user may still answer: open, or back with the agent (it may not revise). */
const ANSWERABLE: readonly ProposalState[] = ["open", "changes-requested"];

/**
 * The user's answer to a proposal. An accept writes through the record type's
 * own path (its validation and side effects); a refusal there keeps the
 * proposal open. Every decision is then typed into the author's task as an
 * event turn, so the agent learns it whether it is working, stopped or closed
 * (reopened: it waits on this answer even once it ended its turn).
 */
export async function decide(
  rawId: string,
  body: DecideProposalBody,
): Promise<DecideAnswer> {
  if (!proposalIdKind.is(rawId)) {
    throw new HttpError(404, `Unknown proposal: ${rawId}`);
  }
  const id = proposalIdKind.key(rawId);
  const target: ProposalState =
    body.decision === "accept"
      ? "accepted"
      : body.decision === "reject"
        ? "rejected"
        : "changes-requested";
  const note = body.decision === "accept" ? null : (body.note ?? null);

  const [proposal] = await db
    .select()
    .from(_proposals)
    .where(eq(_proposals.id, id));
  if (!proposal) throw new HttpError(404, `Unknown proposal: ${id}`);
  if (proposal.state === target && target !== "changes-requested") {
    // Decided already, as asked: a retry after a failed delivery — told again.
    // The stored note is the one this endpoint took (a PromptMarkdown body).
    const stored =
      proposal.decisionNote === null
        ? null
        : PromptMarkdownSchema.parse(proposal.decisionNote);
    const delivery = await tellAgent(proposal, target, stored);
    return { kind: "decided", state: target, delivery };
  }
  if (!ANSWERABLE.includes(proposal.state)) {
    return { kind: "not-open", state: proposal.state };
  }
  if (body.decision === "accept") {
    const applied = await accept(proposal, body.values ?? null);
    if (applied.kind === "refused") return applied;
  }
  // An accept is recorded even when a newer revision superseded the proposal
  // while it was being applied: main HAS its values now, and the newer
  // revision's review says the record moved since it was proposed. Any other
  // answer needs the proposal still answerable.
  const recordable: readonly ProposalState[] =
    target === "accepted" ? [...ANSWERABLE, "superseded"] : ANSWERABLE;
  const [updated] = await db
    .update(_proposals)
    .set({ state: target, decisionNote: note, decidedAt: new Date() })
    .where(
      and(eq(_proposals.id, id), inArray(_proposals.state, [...recordable])),
    )
    .returning({ id: _proposals.id });
  if (!updated) {
    const [now] = await db
      .select({ state: _proposals.state })
      .from(_proposals)
      .where(eq(_proposals.id, id));
    return { kind: "not-open", state: now?.state ?? "superseded" };
  }
  // After the write: the decision stands whatever the delivery answers. A
  // delivery that throws is retried by sending the same decision again (its
  // turn id is derived from it, so it is typed once).
  const delivery = await tellAgent(proposal, target, note);
  return { kind: "decided", state: target, delivery };
}

async function accept(
  proposal: Proposal,
  edited: Record<string, unknown> | null,
): Promise<{ kind: "applied" } | { kind: "refused"; message: string }> {
  const type = proposalTypeOf(proposal.type);
  if (type === null) {
    return {
      kind: "refused",
      message: `No plugin of this app registers "${proposal.type}" any more.`,
    };
  }
  const fields = type.fieldsOf(proposal.scope);
  if (fields === null) {
    return {
      kind: "refused",
      message: `Unknown ${type.label} scope "${proposal.scope}".`,
    };
  }
  const current = await type.read(proposal.recordId);
  if (current === null && !proposal.isNew) {
    return {
      kind: "refused",
      message: `This ${type.label.toLowerCase()} was deleted since it was proposed.`,
    };
  }
  // The record the accept leaves, judged whole before anything is written:
  // main's record now (or the proposed new one) with the keys this accept sets.
  const set = acceptedSet({
    fieldKeys: Object.keys(fields),
    proposed: proposal.values,
    changed: proposal.changed,
    edited,
  });
  const base = current?.values ?? proposal.values;
  const resolved = resolveValues(fields, { ...base, ...set });
  if (resolved.kind === "invalid") {
    return { kind: "refused", message: `Not accepted: ${resolved.message}` };
  }
  if (current === null) {
    return type.apply(
      { kind: "create", id: proposal.recordId, scope: proposal.scope },
      resolved.values,
    );
  }
  if (Object.keys(set).length === 0) return { kind: "applied" };
  return type.apply({ kind: "edit", id: proposal.recordId }, set);
}

const DECISION_WORDS: Record<ProposalState, string> = {
  open: "is open",
  accepted: "was accepted — it is applied on main",
  rejected: "was rejected",
  "changes-requested": "came back with changes requested",
  superseded: "was replaced",
};

async function tellAgent(
  proposal: Proposal,
  state: ProposalState,
  note: PromptMarkdown | null,
): Promise<ProposalDelivery> {
  const revise =
    state === "changes-requested"
      ? "\nRevise it in your worktree (the same record), then run `./equin propose` again: the new revision replaces this one."
      : "";
  const delivery = await deliverEventTurn(
    proposal.authorTaskId,
    {
      id: decisionTurnId(proposal.id, state, note),
      userText: { note: note ?? EMPTY_PROMPT },
      text: (user) =>
        `<proposal-decision proposal="${proposal.id}" type="${proposal.type}" record="${proposal.recordId}" decision="${state}">` +
        `${user.note}</proposal-decision>\n` +
        `Your proposal ${proposal.id} (v${proposal.revision}) ${DECISION_WORDS[state]}.${revise}`,
    },
    // The agent waits on this answer: a closed one is reopened to hear it.
    { ifClosed: "reopen" },
  );
  switch (delivery.kind) {
    case "delivered":
      return delivery.was === "closed" ? "reopened" : "delivered";
    case "no-agent":
      return "no-agent";
    case "resume-blocked":
      return "blocked";
  }
}

/**
 * The ledger id of the turn telling the agent: derived from the proposal, the
 * decision and its note, so a retried request records it once (and a second
 * change request with another note is another turn).
 */
function decisionTurnId(
  proposalId: string,
  state: ProposalState,
  note: string | null,
): TurnId {
  const h = sha256Hex(
    `proposals.decision:${proposalId}:${state}:${JSON.stringify(note)}`,
  );
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  return turnIdKind.parse(`turn-${uuid}`);
}

export const handleDecideProposal = machineHandler(
  decideProposal,
  implementMachine(decideProposal, ({ params, body }) =>
    decide(params.id, body),
  ),
);
