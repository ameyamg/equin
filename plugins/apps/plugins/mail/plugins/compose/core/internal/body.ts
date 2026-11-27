import {
  DOCUMENT_BLOCK_TYPES,
  escapeHtml,
  forestToEmailHtml,
  forestToEmailText,
  parseDocument,
  plainTextForest,
  serializeDocument,
  type DocumentDialect,
} from "@plugins/page/plugins/document-field/core";
import type { SerializedBlock } from "@plugins/page/plugins/editor/core";
import type { DraftContent } from "./draft";
import { bodySigned, messageText } from "./reply";

// A Mail body is text in Pages' format (design:
// research/2026-11-27-apps-mail-compose-text-format.md §2): the markdown
// `serializeDocument` writes over Mail's block set. One field edits it as
// Markdown or Rich; a send renders it as an HTML part and a text/plain
// alternative.

/**
 * Mail's dialect: paragraphs, headings, lists, a quote, code and dividers. The
 * text is read back by us, so a blank line is an empty paragraph (the way an
 * email spaces its paragraphs), the Markdown view never shows `<text/>`, and a
 * line is a block. One module-level object: the field keys its plugins on it.
 */
export const MAIL_BODY_DIALECT: DocumentDialect = {
  blocks: DOCUMENT_BLOCK_TYPES,
  blankLines: "empty-block",
  emptyBlocks: "blank-line",
  softBreaks: "newline",
};

/** Plain text as a Mail body: each line a paragraph, nothing in it read as markdown (`5 * 3` stays `5 * 3`). */
export function plainTextBody(text: string): string {
  return serializeDocument(plainTextForest(text), MAIL_BODY_DIALECT);
}

/** A draft's content with its body as a document: a plain-text body (saved before Mail wrote formatting) read as plain paragraphs. */
export function asDocumentContent(content: DraftContent): DraftContent {
  return content.bodyFormat === "document"
    ? content
    : { ...content, body: plainTextBody(content.body), bodyFormat: "document" };
}

/**
 * The quote a reply carries (`quoteOf`: "On …, … wrote:" then `> ` lines) as a
 * forest: its header line, then the original as ONE quote, each line a
 * literal paragraph.
 */
export function quoteForest(quote: string): SerializedBlock[] {
  const [header = "", ...lines] = quote.replace(/\r\n?/g, "\n").split("\n");
  return [
    ...plainTextForest(header),
    {
      type: "quote",
      data: {},
      expanded: true,
      children: plainTextForest(
        lines.map((l) => l.replace(/^> ?/, "")).join("\n"),
      ),
    },
  ];
}

/** A reply's quote in Mail's dialect — what the editor shows under the body, in the field's own look. */
export function quoteBody(quote: string): string {
  return serializeDocument(quoteForest(quote), MAIL_BODY_DIALECT);
}

/** A body's text/plain rendering (what a plain client shows, signature and quote not included). */
export function bodyText(body: string): string {
  return forestToEmailText(parseDocument(body, MAIL_BODY_DIALECT));
}

/** The parts a message goes out with. */
export interface MessageParts {
  text: string;
  /** Null: text alone (a body saved as plain text before Mail wrote formatting). */
  html: string | null;
}

/**
 * A message's text/plain and HTML parts: the body, then the signature (unless
 * the body is signed already, `bodySigned`), then the quote of what a reply
 * answers. The text part is `messageText` over the body's plain rendering; the
 * HTML part draws the same three — the signature as its lines, the quote under
 * its header as Gmail does (`gmail_quote`, so a client folds it).
 */
export function messageParts(
  body: string,
  bodyFormat: "text" | "document",
  signature: string | null,
  quote: string | null,
): MessageParts {
  if (bodyFormat === "text")
    return { text: messageText(body, signature, quote), html: null };
  const forest = parseDocument(body, MAIL_BODY_DIALECT);
  const plain = forestToEmailText(forest);
  const text = messageText(plain, signature, quote);
  let html = forestToEmailHtml(forest);
  if (signature !== null && !bodySigned(plain))
    html += `<p style="margin:0;white-space:pre-wrap"><br></p><div class="gmail_signature">${signature
      .split("\n")
      .map(escapeHtml)
      .join("<br>")}</div>`;
  if (quote !== null)
    html += `<br><div class="gmail_quote">${forestToEmailHtml(quoteForest(quote))}</div>`;
  return { text, html };
}
