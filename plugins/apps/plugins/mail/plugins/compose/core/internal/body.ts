import {
  DOCUMENT_BLOCK_TYPES,
  emailHtmlToForest,
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
import type { MessageContent } from "@plugins/apps/plugins/mail/plugins/provider/core";
import { bodySigned, messageText } from "./message-text";

// A Mail body is text in Pages' format (design:
// research/2026-11-27-apps-mail-compose-text-format.md §2): the markdown
// `serializeDocument` writes over Mail's block set. One field edits it as
// Markdown or Rich; a send renders it as an HTML part and a text/plain
// alternative.

/**
 * Mail's dialect: paragraphs, headings, lists, a quote, code and dividers. The
 * text is read back by us, so a blank line is an empty paragraph (the way an
 * email spaces its paragraphs) — first and last ones too (a line pressed above
 * a forwarded message) — the Markdown view never shows `<text/>`, and a line
 * is a block. One module-level object: the field keys its plugins on it.
 */
export const MAIL_BODY_DIALECT: DocumentDialect = {
  blocks: DOCUMENT_BLOCK_TYPES,
  blankLines: "every-empty-block",
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
 * A message's content as a document: its HTML part as drawn
 * (`emailHtmlToForest`), else its text as literal paragraphs.
 */
export function contentForest(
  m: Pick<MessageContent, "text" | "html">,
): SerializedBlock[] {
  if (m.html !== null) return emailHtmlToForest(m.html.content);
  return m.text === null ? [] : plainTextForest(m.text.content);
}

/** A reply's quote as a document: its header line, then the original as ONE quote. */
export function quoteDocument(
  header: string,
  original: SerializedBlock[],
): string {
  return serializeDocument(
    [
      ...plainTextForest(header),
      ...(original.length === 0
        ? []
        : [
            {
              type: "quote",
              data: {},
              expanded: true,
              children: original,
            },
          ]),
    ],
    MAIL_BODY_DIALECT,
  );
}

/**
 * A quote as drafts started before the quote was a document hold it ("On …,
 * … wrote:" then `> ` lines) as one: its header line, then the original as
 * one quote, each line a literal paragraph.
 */
export function legacyQuoteDocument(quote: string): string {
  const [header = "", ...lines] = quote.replace(/\r\n?/g, "\n").split("\n");
  return quoteDocument(
    header,
    plainTextForest(lines.map((l) => l.replace(/^> ?/, "")).join("\n")),
  );
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

/** Blank lines left at the end of a body: what it goes out with stops at its last line. */
function trimTrailingBlank(forest: SerializedBlock[]): SerializedBlock[] {
  let end = forest.length;
  while (end > 0) {
    const b = forest[end - 1]!;
    const runs = (b.data as { text?: unknown[] } | undefined)?.text;
    if (b.type !== "text" || b.children.length > 0 || (runs?.length ?? 0) > 0)
      break;
    end--;
  }
  return forest.slice(0, end);
}

/**
 * A message's text/plain and HTML parts: the body, then the signature (unless
 * the body is signed already, `bodySigned`), then the quote of what a reply
 * answers (a document, `quoteOf`). The text part is `messageText` over the
 * plain renderings of the body and the quote; the HTML part draws the same
 * three — the signature as its lines, the quote under its header as Gmail does
 * (`gmail_quote`, so a client folds it).
 */
export function messageParts(
  body: string,
  bodyFormat: "text" | "document",
  signature: string | null,
  quote: string | null,
): MessageParts {
  const quoteForest =
    quote === null ? null : parseDocument(quote, MAIL_BODY_DIALECT);
  const quoteText =
    quoteForest === null ? null : forestToEmailText(quoteForest);
  if (bodyFormat === "text")
    return { text: messageText(body, signature, quoteText), html: null };
  const forest = trimTrailingBlank(parseDocument(body, MAIL_BODY_DIALECT));
  const plain = forestToEmailText(forest);
  const text = messageText(plain, signature, quoteText);
  let html = forestToEmailHtml(forest);
  if (signature !== null && !bodySigned(plain))
    html += `<p style="margin:0;white-space:pre-wrap"><br></p><div class="gmail_signature">${signature
      .split("\n")
      .map(escapeHtml)
      .join("<br>")}</div>`;
  if (quoteForest !== null)
    html += `<br><div class="gmail_quote">${forestToEmailHtml(quoteForest)}</div>`;
  return { text, html };
}
