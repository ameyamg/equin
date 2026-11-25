import { resolveAttachmentRefs } from "@plugins/conversations/server";
import type { DecisionId } from "../../core";
import { decisionAttachments } from "../../server/internal/schema-attachments";

/**
 * A note the user wrote on a decision, taken: the attachments it references
 * linked to the decision (so the orphan sweep keeps what the thread shows),
 * and the note as its agent reads it — each attachment ref its disk path.
 * Machine-side: the disk paths are the computer's.
 */
export async function takeDecisionNote(
  decisionId: DecisionId,
  note: string,
): Promise<string> {
  const { text, attachmentIds } = await resolveAttachmentRefs(note);
  if (attachmentIds.length > 0)
    await decisionAttachments.add(decisionId, attachmentIds);
  return text;
}
