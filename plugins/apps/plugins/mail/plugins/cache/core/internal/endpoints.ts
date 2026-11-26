import { z } from "zod";
import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";
import { MailOpUndoSchema, MailThreadOpSchema } from "./ops";

// Triage and label writes (design §6). Reads are live (`mail.threads`,
// `mail.mailboxes`); these are the writes.

/**
 * One triage op on threads: answered once the cache holds it (the windows
 * notified) and the provider's write is queued durably, with the ops that
 * undo it (each thread as the cache held it before). The browser draws the
 * op as its prediction from the click on (`writeRows`).
 */
export const applyMailThreadOp = defineEndpoint({
  route: "POST /api/mail/threads/apply",
  body: z.object({
    ids: z.array(z.string().min(1)).min(1).max(1000),
    op: MailThreadOpSchema,
  }),
  response: z.object({ undo: z.array(MailOpUndoSchema) }),
});

/** A label at a `/`-separated path, each missing level made; answers the last level's id. */
export const createMailLabel = defineEndpoint({
  route: "POST /api/mail/labels",
  body: z.object({ path: z.string().trim().min(1).max(225) }),
  response: z.object({ id: z.string() }),
});

/** A label's own name (its place in the tree kept). */
export const renameMailLabel = defineEndpoint({
  route: "PATCH /api/mail/labels/:id",
  body: z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(225)
      .refine((n) => !n.includes("/"), "a label name may not contain /"),
  }),
});

export const deleteMailLabel = defineEndpoint({
  route: "DELETE /api/mail/labels/:id",
});
