import {
  coalesce,
  MARK_ORDER,
  runsOf,
  type ColorToken,
  type Mark,
  type RichText,
  type SerializedBlock,
  type TextRun,
} from "@plugins/page/plugins/editor/core";
import { isDocumentBlockType, type DocumentBlockType } from "./dialect";

// A document as an email: the HTML part a recipient's client draws, and the
// text/plain alternative a plain client shows. One walk over the block forest
// (`parseDocument`'s), so the two parts cannot disagree on structure.
//
// - HTML carries no stylesheet, no CSS variable and no font: the recipient's
//   client picks its own font and background. Styles are inline and few
//   (margins, so blank lines stay the only spacing, as in the editor; the
//   quote's bar; a colour).
// - Text keeps the markdown marks that read naturally (`**`, `_`, `~~`,
//   `` ` ``, `[x](url)`), drops the two that are tags (underline, colour —
//   their text kept), writes a quote as `> ` lines (the email convention) and
//   escapes nothing: it is read by a person, never parsed back.

/**
 * The colour of each text-colour token in an email: fixed, light-theme values
 * that read on a white page — email has no CSS variables, and most clients draw
 * mail on white whatever the sender's theme.
 */
export const EMAIL_TEXT_COLORS: Record<
  Exclude<ColorToken, "default">,
  string
> = {
  gray: "#787774",
  brown: "#9f6b53",
  orange: "#d9730d",
  yellow: "#cb912f",
  green: "#448361",
  blue: "#337ea9",
  purple: "#9065b0",
  pink: "#c14c8a",
  red: "#d44c47",
};

/** A paragraph: no margin (blank lines are the spacing, as in the editor), its spaces kept as written. */
const PARAGRAPH_STYLE = "margin:0;white-space:pre-wrap";

/** The bar a quote is drawn with: Gmail's own, so a reply's quote and a quote written in the body look alike. */
const QUOTE_STYLE =
  "margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex";

const HTML_TAG: Record<Mark, string> = {
  bold: "b",
  italic: "i",
  underline: "u",
  strikethrough: "s",
  code: "code",
};

/** What a mark is spelled as in the text part ("" — dropped, its text kept). */
const TEXT_MARKER: Record<Mark, string> = {
  bold: "**",
  italic: "_",
  underline: "",
  strikethrough: "~~",
  code: "`",
};

/** Escapes text for an HTML text node or a double-quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A link a recipient may follow: web and mail addresses only (anything else is drawn as its text). */
function safeHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : null;
}

// ── inline ──────────────────────────────────────────────────────────────

/** One formatting a run is wrapped in, outermost first: its link, its colour, then its marks. */
type Wrap =
  | { kind: "link"; href: string }
  | { kind: "color"; color: Exclude<ColorToken, "default"> }
  | { kind: "mark"; mark: Mark };

const wrapKey = (w: Wrap): string =>
  w.kind === "link"
    ? `l:${w.href}`
    : w.kind === "color"
      ? `c:${w.color}`
      : `m:${w.mark}`;

function wrapsOf(run: TextRun): Wrap[] {
  const out: Wrap[] = [];
  if (run.link) out.push({ kind: "link", href: run.link });
  if (run.color && run.color !== "default")
    out.push({ kind: "color", color: run.color });
  for (const mark of MARK_ORDER)
    if (run.marks?.includes(mark)) out.push({ kind: "mark", mark });
  return out;
}

interface InlineSpelling {
  open(w: Wrap): string;
  close(w: Wrap): string;
  text(text: string, inCode: boolean): string;
}

/**
 * Runs written with properly nested wraps: a wrap two neighbouring runs share
 * stays open across them (`**a _b_**`, not `**a ****_b_**`).
 */
function emitInline(runs: RichText, s: InlineSpelling): string {
  let out = "";
  const open: Wrap[] = [];
  for (const run of coalesce(runs)) {
    const wraps = wrapsOf(run);
    let keep = 0;
    while (
      keep < open.length &&
      keep < wraps.length &&
      wrapKey(open[keep]!) === wrapKey(wraps[keep]!)
    )
      keep++;
    while (open.length > keep) out += s.close(open.pop()!);
    for (const w of wraps.slice(keep)) {
      out += s.open(w);
      open.push(w);
    }
    out += s.text(run.text, run.marks?.includes("code") ?? false);
  }
  while (open.length > 0) out += s.close(open.pop()!);
  return out;
}

const HTML_INLINE: InlineSpelling = {
  open(w) {
    if (w.kind === "mark") return `<${HTML_TAG[w.mark]}>`;
    if (w.kind === "color")
      return `<span style="color:${EMAIL_TEXT_COLORS[w.color]}">`;
    const href = safeHref(w.href);
    return href === null ? "" : `<a href="${escapeHtml(href)}">`;
  },
  close(w) {
    if (w.kind === "mark") return `</${HTML_TAG[w.mark]}>`;
    if (w.kind === "color") return "</span>";
    return safeHref(w.href) === null ? "" : "</a>";
  },
  text: (text) => escapeHtml(text).replace(/\n/g, "<br>"),
};

/** The text part's inline spelling. A link whose text is its address is written once. */
function textInline(runs: RichText): string {
  const spelled = emitInline(
    runs.map((r) =>
      r.link !== undefined && r.text === r.link ? { ...r, link: undefined } : r,
    ),
    {
      open: (w) =>
        w.kind === "mark" ? TEXT_MARKER[w.mark] : w.kind === "link" ? "[" : "",
      close: (w) =>
        w.kind === "mark"
          ? TEXT_MARKER[w.mark]
          : w.kind === "link"
            ? `](${w.href})`
            : "",
      text: (text) => text,
    },
  );
  return spelled;
}

// ── blocks ──────────────────────────────────────────────────────────────

function typeOf(block: SerializedBlock): DocumentBlockType {
  if (!isDocumentBlockType(block.type))
    throw new Error(
      `document-field email: a ${JSON.stringify(block.type)} block is not a document block — the forest was not read in a document dialect`,
    );
  return block.type;
}

const runsOfBlock = (b: SerializedBlock): RichText =>
  runsOf((b.data as { text?: unknown } | undefined)?.text);

function codeOf(b: SerializedBlock): string {
  const code = (b.data as { code?: unknown } | undefined)?.code;
  if (typeof code !== "string")
    throw new Error("document-field email: a code block without its code");
  return code;
}

const LIST_TAG = { "bulleted-list": "ul", "numbered-list": "ol" } as const;

/** Siblings cut into runs of one list kind (one `<ul>` / `<ol>`, one numbering), every other block alone. */
function groups(blocks: readonly SerializedBlock[]): SerializedBlock[][] {
  const out: SerializedBlock[][] = [];
  for (const b of blocks) {
    const t = typeOf(b);
    const last = out.at(-1);
    if (
      last &&
      (t === "bulleted-list" || t === "numbered-list") &&
      last[0]!.type === t
    )
      last.push(b);
    else out.push([b]);
  }
  return out;
}

function htmlBlocks(blocks: readonly SerializedBlock[]): string {
  return groups(blocks)
    .map((group) => {
      const first = group[0]!;
      const t = typeOf(first);
      if (t === "bulleted-list" || t === "numbered-list") {
        const items = group
          .map(
            (b) =>
              `<li>${emitInline(runsOfBlock(b), HTML_INLINE)}${htmlBlocks(b.children)}</li>`,
          )
          .join("");
        return `<${LIST_TAG[t]} style="margin:0">${items}</${LIST_TAG[t]}>`;
      }
      return htmlBlock(first, t);
    })
    .join("");
}

function htmlBlock(b: SerializedBlock, t: DocumentBlockType): string {
  // A line's nested blocks (an indented paragraph under it) sit indented below it.
  const nested =
    b.children.length === 0
      ? ""
      : `<div style="margin-left:1.5em">${htmlBlocks(b.children)}</div>`;
  switch (t) {
    case "text": {
      const inline = emitInline(runsOfBlock(b), HTML_INLINE);
      return `<p style="${PARAGRAPH_STYLE}">${inline === "" ? "<br>" : inline}</p>${nested}`;
    }
    case "heading-1":
    case "heading-2":
    case "heading-3": {
      const tag = `h${t.slice(-1)}`;
      return `<${tag} style="margin:0">${emitInline(runsOfBlock(b), HTML_INLINE)}</${tag}>${nested}`;
    }
    case "quote":
      return `<blockquote style="${QUOTE_STYLE}">${htmlBlocks(b.children)}</blockquote>`;
    case "code-block":
      return `<pre style="margin:0"><code>${escapeHtml(codeOf(b))}</code></pre>`;
    case "divider":
      return "<hr>";
    case "bulleted-list":
    case "numbered-list":
      throw new Error("document-field email: a list item outside its list");
  }
}

function textBlocks(blocks: readonly SerializedBlock[]): string[] {
  const lines: string[] = [];
  for (const group of groups(blocks)) {
    group.forEach((b, i) => {
      const t = typeOf(b);
      const nested = textBlocks(b.children).map((l) =>
        l === "" ? "" : `  ${l}`,
      );
      switch (t) {
        case "text":
          lines.push(textInline(runsOfBlock(b)), ...nested);
          return;
        case "heading-1":
        case "heading-2":
        case "heading-3":
          lines.push(
            `${"#".repeat(Number(t.slice(-1)))} ${textInline(runsOfBlock(b))}`,
            ...nested,
          );
          return;
        case "bulleted-list":
          lines.push(`* ${textInline(runsOfBlock(b))}`, ...nested);
          return;
        case "numbered-list":
          lines.push(`${i + 1}. ${textInline(runsOfBlock(b))}`, ...nested);
          return;
        case "quote":
          lines.push(
            ...textBlocks(b.children).map((l) => (l === "" ? ">" : `> ${l}`)),
          );
          return;
        case "code-block":
          lines.push("```", ...codeOf(b).split("\n"), "```");
          return;
        case "divider":
          lines.push("---");
          return;
      }
    });
  }
  return lines;
}

/**
 * A document as an email's HTML part: `<p>` per line (an empty one a blank
 * line, its spaces kept), `<h1>`–`<h3>`, `<ul>` / `<ol>`, `<blockquote>`, `<pre>`, `<hr>`;
 * marks as `<b> <i> <u> <s> <code>`, links as `<a>` (web and mail addresses
 * only), colour as an inline style from {@link EMAIL_TEXT_COLORS}. A fragment,
 * no `<html>` around it.
 */
export function forestToEmailHtml(forest: readonly SerializedBlock[]): string {
  return htmlBlocks(forest);
}

/**
 * A document as an email's text/plain part: markdown marks kept, underline
 * and colour dropped (their text kept), a quote as `> ` lines, `* ` bullets
 * and `1. ` items, nothing escaped.
 */
export function forestToEmailText(forest: readonly SerializedBlock[]): string {
  return textBlocks(forest).join("\n");
}

/** Plain text as a forest: one paragraph per line, its text literal (nothing in it is read as markdown). */
export function plainTextForest(text: string): SerializedBlock[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => ({
      type: "text",
      data: { text: line === "" ? [] : [{ text: line }] },
      expanded: true,
      children: [],
    }));
}
