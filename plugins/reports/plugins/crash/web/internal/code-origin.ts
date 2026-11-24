import { crashFieldsOf } from "@plugins/packages/plugins/error-subject/core";
import { stackCodeOrigin, type CodeOrigin } from "../../core";

/**
 * Whose code `stack` ran in (core/code-origin.ts) — judged against this
 * document's own inline scripts, read now, as the browser holds them.
 */
export function pageCodeOrigin(stack: string | null | undefined): CodeOrigin {
  const inlineScripts = Array.from(document.scripts)
    .filter((s) => !s.src)
    .map((s) => s.text);
  return stackCodeOrigin(stack, {
    documentUrl: window.location.href,
    inlineScripts,
  });
}

/**
 * A window error's or unhandled rejection's crash fields, with whose code its
 * stack ran in (`pageCodeOrigin`).
 */
export function crashFieldsWithOrigin(
  err: Error,
): ReturnType<typeof crashFieldsOf> & { codeOrigin: CodeOrigin } {
  const fields = crashFieldsOf(err);
  return { ...fields, codeOrigin: pageCodeOrigin(fields.stack) };
}
