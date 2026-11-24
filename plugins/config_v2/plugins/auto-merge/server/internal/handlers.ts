import { implement, HttpError } from "@plugins/infra/plugins/endpoints/core";
import {
  AutoMergeResolveRefused,
  AutoMergeUndoRefused,
  resolveAutoMergeFieldByPath,
  stampAutoMergeByPath,
  undoAutoMergeByPath,
} from "@plugins/config_v2/server";
import { originOf } from "@plugins/infra/plugins/request-origin/core";
import {
  acknowledgeAutoMerge,
  resolveAutoMergeField,
  undoAutoMerge,
} from "../../core";

// Every write passes `originOf(req)`, never a literal: an agent's Undo is
// ledgered like any other agent config write.

export const handleUndoAutoMerge = implement(
  undoAutoMerge,
  async ({ body, req }) => {
    const refused: { storePath: string; scopeId?: string; reason: string }[] =
      [];
    for (const target of body.targets) {
      try {
        await undoAutoMergeByPath(target.storePath, {
          writer: originOf(req),
          scopeId: target.scopeId,
        });
      } catch (err) {
        // The registry's refusals (superseded, edited since, nothing to undo)
        // are answers about one target; the others still undo. Anything else
        // is a failure, and fails the request.
        if (!(err instanceof AutoMergeUndoRefused)) throw err;
        refused.push({ ...target, reason: err.message });
      }
    }
    return { refused };
  },
);

export const handleAcknowledgeAutoMerge = implement(
  acknowledgeAutoMerge,
  async ({ body, req }) => {
    try {
      await stampAutoMergeByPath(
        body.storePath,
        body.recordId,
        "acknowledgedAt",
        {
          writer: originOf(req),
          scopeId: body.scopeId,
        },
      );
    } catch (err) {
      throw new HttpError(
        400,
        err instanceof Error ? err.message : String(err),
      );
    }
  },
);

export const handleResolveAutoMergeField = implement(
  resolveAutoMergeField,
  async ({ body, req }) => {
    try {
      await resolveAutoMergeFieldByPath(
        body.storePath,
        { recordId: body.recordId, field: body.field, choice: body.choice },
        { writer: originOf(req), scopeId: body.scopeId },
      );
    } catch (err) {
      // The registry's refusals are an answer about this field; anything
      // else is a failure.
      if (!(err instanceof AutoMergeResolveRefused)) throw err;
      throw new HttpError(400, err.message);
    }
  },
);
