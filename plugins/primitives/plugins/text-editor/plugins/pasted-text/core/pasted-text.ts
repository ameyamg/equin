/**
 * The pasted-text block as text: how a block is written into a draft (and so
 * into the message an agent receives), how it is found again, and what a paste
 * has to be to become one.
 *
 * The wire form is a plain tag, no attributes:
 *
 *   <pasted_content>
 *   …the pasted text…
 *   </pasted_content>
 *
 * The tag name is what tells the agent the text is material the person pasted,
 * not words they wrote. It is deliberately NOT Claude Code's own paste grammar
 * (`<pasted_content id="e112">` … `</pasted_content id="e112">`):
 * `transcript-source`'s `unwrapPastedContent` strips that form on every
 * transcript read, so a block sent in it would come back as different text than
 * was sent (the pending turn never confirmed) and lose its block on screen. The
 * id-less form is left alone by that parser, which only takes an exact match.
 */

import {
  tokenizedSegments,
  type TokenScanExtension,
} from "@plugins/primitives/plugins/text-editor/plugins/token-extension/core";

/** One block, anywhere in a text. Group 1 is the body as written (escaped). */
export const PASTED_TEXT_RE =
  /<pasted_content>\n([\s\S]*?)\n<\/pasted_content>/;

/**
 * Any body can be written as one block: a closing tag inside it gains one
 * backslash on the wire (`</pasted_content` → `<\/pasted_content`, and a run
 * of backslashes there grows by one, so it reads back exactly). Without it a
 * body holding `</pasted_content>` would end its block early, and one holding
 * Claude Code's own `</pasted_content id="…">` would be unwrapped from the
 * transcript, which then no longer reads back as the text that was sent.
 */
const CLOSE_IN_BODY = /<(\\*)\/pasted_content/g;
const ESCAPED_CLOSE = /<\\(\\*)\/pasted_content/g;

function escapeBody(body: string): string {
  return body.replace(CLOSE_IN_BODY, "<\\$1/pasted_content");
}

/** The body a block's written text (group 1 of {@link PASTED_TEXT_RE}) holds. */
export function unescapePastedBody(written: string): string {
  return written.replace(ESCAPED_CLOSE, "<$1/pasted_content");
}

/** The block's text for `body`. */
export function wrapPastedText(body: string): string {
  return `<pasted_content>\n${escapeBody(body)}\n</pasted_content>`;
}

/** A paste this many lines or longer becomes a block. */
export const LARGE_PASTE_LINES = 10;
/** …and so does one this many characters or longer (one huge line: minified JSON, a token). */
export const LARGE_PASTE_CHARS = 1000;

/**
 * Is this pasted text a block rather than text typed in place? Below both
 * bounds it lands as plain text; a wrong guess either way is one click (the
 * block's Expand).
 *
 * Measured as the editor would DRAW it, not as its bytes: every token of
 * `extensions` (a `<ui-context>` chip is ~900 characters of attributes drawn as
 * one pill) counts as one character and none of its newlines, so a selection
 * holding a few chips pastes as chips, not as a block. Taking the editor's
 * token set is what makes that hold for every token family, present and future.
 */
export function isLargePaste(
  text: string,
  extensions: readonly (TokenScanExtension & {
    readonly spansLines: boolean;
  })[],
): boolean {
  const drawn = tokenizedSegments(text, extensions)
    .map((s) => (s.kind === "text" ? s.text : TOKEN_CHAR))
    .join("");
  return (
    drawn.length >= LARGE_PASTE_CHARS || lineCount(drawn) >= LARGE_PASTE_LINES
  );
}

/** What a token weighs in {@link isLargePaste}: one character, like the pill it draws. */
const TOKEN_CHAR = "\uFFFC";

export function lineCount(text: string): number {
  let n = 1;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) n++;
  return n;
}

/** What a block holds, read off its text — only for its label and icon. */
export type PastedTextKind = "log" | "code" | "json" | "text";

export function pastedTextKind(body: string): PastedTextKind {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(body);
      return "json";
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
    }
  }
  if (
    /^\s*(?:import |export |function |const |let |def |class |package |#include|fn |pub |use )/m.test(
      body,
    )
  )
    return "code";
  if (/\b(?:ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE)\b|^\s+at .+:\d+/m.test(body))
    return "log";
  return "text";
}

/** One run of a text: what was written in place, or a pasted block's body. */
export type PastedTextSegment =
  { kind: "text"; text: string } | { kind: "pasted"; body: string };

/**
 * `text` cut at its blocks, in order. A text with no block is one `text`
 * segment.
 */
export function splitPastedText(text: string): PastedTextSegment[] {
  const out: PastedTextSegment[] = [];
  const re = new RegExp(PASTED_TEXT_RE.source, "g");
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last)
      out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "pasted", body: unescapePastedBody(m[1]!) });
    last = m.index + m[0].length;
  }
  if (last < text.length || out.length === 0)
    out.push({ kind: "text", text: text.slice(last) });
  return out;
}
