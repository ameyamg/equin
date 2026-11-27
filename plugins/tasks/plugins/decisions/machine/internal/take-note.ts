import { resolveAttachmentRefs } from "@plugins/conversations/server";
import type { PromptMarkdown } from "@plugins/primitives/plugins/text-editor/core";
import type { DecisionId } from "../../core";
import { decisionAttachments } from "../../server/internal/schema-attachments";

/**
 * A note the user wrote on a decision, kept with it: the attachments it
 * references linked to the decision, so the orphan sweep keeps what the
 * thread shows — whether the note is delivered or only kept. Delivery
 * resolves the note for the agent itself (`deliverEventTurn`).
 */
export async function keepDecisionNote(
  decisionId: DecisionId,
  note: PromptMarkdown,
): Promise<void> {
  const { attachmentIds } = await resolveAttachmentRefs(note);
  if (attachmentIds.length > 0)
    await decisionAttachments.add(decisionId, attachmentIds);
}
