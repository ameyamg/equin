import { defineInlineTokenNode } from "@plugins/primitives/plugins/text-editor/plugins/token-extension/plugins/node/core";
import { unescapePastedBody, wrapPastedText } from "./pasted-text";

/** A `type` alias, never an `interface` — `defineInlineTokenNode` needs the index signature. */
export type PastedTextFields = { body: string };

/**
 * The pasted block as a Lexical token: one node holding the body, written out
 * as its `<pasted_content>` tag. `textContent: "token"` so a copy out of the
 * editor carries the whole block (a bare decorator would copy as nothing).
 */
export const pastedTextNode = defineInlineTokenNode<PastedTextFields>({
  type: "pasted-text",
  fields: ["body"],
  token: ({ body }) => wrapPastedText(body),
  fieldsOf: (match) => ({ body: unescapePastedBody(match[1]!) }),
  textContent: "token",
});
