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

const LabelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(225)
  .refine((n) => !n.includes("/"), "a label name may not contain /");

/**
 * A label: at a `/`-separated path (each missing level made — the search's
 * "Create Travel / Ski 2027"), or one name under a known parent by its id
 * (the provider builds the full name). Answers the (last) label's id.
 */
export const createMailLabel = defineEndpoint({
  route: "POST /api/mail/labels",
  body: z.union([
    z.object({ path: z.string().trim().min(1).max(225) }),
    z.object({ name: LabelNameSchema, parentId: z.string().min(1) }),
  ]),
  response: z.object({ id: z.string() }),
});

/**
 * One change to a label: its own name (its place and sub-labels kept), its
 * parent (null: a root; its sub-labels move with it), or its colour — a
 * background of the provider's palette (`mail.account-status`'s
 * `mailboxColors`), or null to clear it.
 */
export const MailLabelChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rename"), name: LabelNameSchema }),
  z.object({ kind: z.literal("move"), parentId: z.string().min(1).nullable() }),
  z.object({
    kind: z.literal("color"),
    background: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "a colour is #rrggbb")
      .nullable(),
  }),
]);
export type MailLabelChange = z.infer<typeof MailLabelChangeSchema>;

/** Changes a label (`MailLabelChange`); answered once the provider has it and the mailboxes are relisted. */
export const updateMailLabel = defineEndpoint({
  route: "PATCH /api/mail/labels/:id",
  body: MailLabelChangeSchema,
});

/** Deletes a label: its sub-labels move up to its parent; its threads keep their other labels. */
export const deleteMailLabel = defineEndpoint({
  route: "DELETE /api/mail/labels/:id",
});
