import { defineIdKind, type IdOf } from "@plugins/ids/core";

/**
 * A Mail draft: minted by the browser (a uuid) when a compose window or a
 * reply box opens, so the first keystroke is saved under it with no round
 * trip first.
 */
export const mailDraftIdKind = defineIdKind({
  prefix: "mdraft",
  label: "Mail draft",
  shape: "uuid",
});
export type MailDraftId = IdOf<typeof mailDraftIdKind>;
