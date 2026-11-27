import {
  AttachmentConflictError,
  AttachmentTooLargeError,
  getAttachment,
  importAttachment,
  isAttachmentId,
} from "@plugins/infra/plugins/attachments/server";
import { HttpError, implement } from "@plugins/infra/plugins/endpoints/server";
import {
  importProposalAttachment,
  missingProposalAttachments,
} from "../../core";

/** Which of a proposal's files this instance does not hold yet. */
export const handleMissingProposalAttachments = implement(
  missingProposalAttachments,
  async ({ body }) => {
    const missing: string[] = [];
    for (const id of body.ids) {
      if ((await getAttachment(id)) === null) missing.push(id);
    }
    return { missing };
  },
);

/**
 * One file of a proposal, streamed in under the id it has in the agent's
 * worktree. Unlinked here until its proposal arrives and links it — the orphan
 * sweep's TTL is far longer than a `./equin propose`.
 */
export const handleImportProposalAttachment = implement(
  importProposalAttachment,
  async ({ params, body, query }) => {
    if (!isAttachmentId(params.id)) {
      throw new HttpError(
        400,
        `not an attachment id (a lowercase UUID): ${params.id}`,
      );
    }
    try {
      const { kind } = await importAttachment({
        id: params.id,
        filename: query.filename,
        mime: query.mime || "application/octet-stream",
        size: query.size,
        bytes: body instanceof Blob ? body.stream() : body,
      });
      return { kind };
    } catch (err) {
      if (err instanceof AttachmentTooLargeError) {
        throw new HttpError(413, err.message);
      }
      if (err instanceof AttachmentConflictError) {
        throw new HttpError(409, err.message);
      }
      throw err;
    }
  },
);
