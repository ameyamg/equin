import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { mediaAttachmentIds } from "@plugins/fields/plugins/media/core";
import { getAttachment } from "@plugins/infra/plugins/attachments/server";
import { implement } from "@plugins/infra/plugins/endpoints/server";
import {
  changedKeys,
  jsonEqual,
  proposalIdKind,
  receiveProposal,
  type ProposalOutcome,
} from "../../core";
import {
  conversationIdKind,
  taskIdKind,
} from "@plugins/tasks/plugins/task-ids/core";
import { taskOfConversation } from "./author";
import { proposalTypeOf } from "./registry";
import { proposalAttachments } from "./schema-attachments";
import { _proposals } from "./tables";
import { defaultValues, resolveValues } from "./values";

/**
 * Store one record an agent's worktree proposes: diffed against THIS
 * instance's record (main's), an open proposal superseding the task's open one
 * for the same record. Every refusal is an answer, never a throw: one bad
 * record does not drop the rest of a `./equin propose`.
 */
export async function receive(input: {
  type: string;
  scope: string;
  recordId: string;
  values: Record<string, unknown>;
  note: string;
  conversationId: string;
  worktree: string;
  forkedAt: string;
}): Promise<ProposalOutcome> {
  const type = proposalTypeOf(input.type);
  if (type === null) {
    return refused(
      `no plugin of this app registers the record type "${input.type}" — main may be older than the worktree: push the change that registers it first`,
    );
  }
  const fields = type.fieldsOf(input.scope);
  if (fields === null) {
    return refused(`${type.label}: unknown scope "${input.scope}" here`);
  }
  const proposed = resolveValues(fields, input.values);
  if (proposed.kind === "invalid") {
    return refused(
      `${type.label}: the values do not fit its fields: ${proposed.message}`,
    );
  }
  const ownerTask = conversationIdKind.is(input.conversationId)
    ? await taskOfConversation(input.conversationId)
    : null;
  if (ownerTask === null) {
    return refused(
      `no task here holds conversation ${input.conversationId}: run ./equin propose from the agent's own session`,
    );
  }
  const taskId = taskIdKind.key(ownerTask);
  const conversationId = conversationIdKind.key(input.conversationId);
  const current = await type.read(input.recordId);
  if (current !== null && current.scope !== input.scope) {
    return refused(
      `${type.label} ${input.recordId} is in "${current.scope}" here, not "${input.scope}"`,
    );
  }
  const base =
    current === null
      ? defaultValues(fields)
      : baseValuesOf(fields, current.values);
  const changed = changedKeys(Object.keys(fields), base, proposed.values);
  if (changed.length === 0) return { kind: "unchanged" };

  const attachmentIds = mediaAttachmentIds(fields, proposed.values);
  for (const id of attachmentIds) {
    if ((await getAttachment(id)) === null) {
      return refused(`the file ${id} was not sent here first`);
    }
  }

  const forkedAt = new Date(input.forkedAt);
  const id = proposalIdKind.mint();
  const stored = await db.transaction(async (tx) => {
    // One proposal of one record from one task at a time: two `./equin
    // propose` in flight must not both read the same latest revision.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`proposals:${taskId}:${type.id}:${input.recordId}`}))`,
    );
    const [latest] = await tx
      .select({
        id: _proposals.id,
        revision: _proposals.revision,
        state: _proposals.state,
        values: _proposals.values,
      })
      .from(_proposals)
      .where(
        and(
          eq(_proposals.authorTaskId, taskId),
          eq(_proposals.type, type.id),
          eq(_proposals.recordId, input.recordId),
        ),
      )
      .orderBy(desc(_proposals.revision))
      .limit(1)
      .for("update");
    // `./equin propose` sends every record the worktree changed: one the user
    // already decided comes back unchanged with each later propose. It is
    // not proposed again (after an Edit then accept, that would offer to
    // undo the user's own edits) until the agent edits it again.
    if (
      latest !== undefined &&
      (latest.state === "accepted" || latest.state === "rejected") &&
      jsonEqual(latest.values, proposed.values)
    ) {
      return { kind: "decided" as const, id: latest.id, state: latest.state };
    }
    if (
      latest !== undefined &&
      (latest.state === "open" || latest.state === "changes-requested")
    ) {
      await tx
        .update(_proposals)
        .set({ state: "superseded" })
        .where(eq(_proposals.id, latest.id));
    }
    const revision = (latest?.revision ?? 0) + 1;
    await tx.insert(_proposals).values({
      id,
      type: type.id,
      scope: input.scope,
      recordId: input.recordId,
      isNew: current === null,
      baseVersion: current?.version ?? null,
      baseValues: current === null ? null : base,
      values: proposed.values,
      changed,
      note: input.note,
      authorTaskId: taskId,
      authorConversationId: conversationId,
      worktree: input.worktree,
      editedOnMainSinceFork:
        current !== null && current.updatedAt.getTime() > forkedAt.getTime(),
      revision,
      previousId: latest?.id ?? null,
      state: "open",
    });
    return { kind: "proposed" as const, revision };
  });
  if (stored.kind === "decided") return stored;
  await proposalAttachments.set(id, attachmentIds);
  return { kind: "proposed", id, revision: stored.revision, changed };
}

/** Main's stored values read through the fields (a field added since takes its default); kept raw when they no longer parse. */
function baseValuesOf(
  fields: Parameters<typeof resolveValues>[0],
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const resolved = resolveValues(fields, values);
  return resolved.kind === "valid" ? resolved.values : { ...values };
}

function refused(message: string): ProposalOutcome {
  return { kind: "refused", message };
}

export const handleReceiveProposal = implement(receiveProposal, ({ body }) =>
  receive(body),
);
