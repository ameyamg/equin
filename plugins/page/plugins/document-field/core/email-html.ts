import { Parser } from "htmlparser2";
import {
  coalesce,
  MARK_ORDER,
  type ColorToken,
  type Mark,
  type RichText,
  type SerializedBlock,
  type TextRun,
} from "@plugins/page/plugins/editor/core";
import { EMAIL_TEXT_COLORS } from "./email";

// An email's HTML as a document — the inverse of `forestToEmailHtml`, read
// from ANY sender's HTML (a newsletter, Gmail's own mail, ours), so a reply
// can quote what the recipient saw and a forward can carry it.
//
// What a document can hold is kept: paragraphs (a `<div>` / `<p>` / `<br>`
// line each, Gmail's and ours alike), headings, lists, quotes, code, rules;
// bold, italic, underline, strike, code, links (web and mail addresses only)
// and a colour, snapped to the nearest text-colour token. Everything else —
// tables (each cell a paragraph), images, fonts, sizes, backgrounds — is drawn
// as its text, and what a client hides (`display:none`, `<style>`, `<head>`)
// is left out.
//
// Spacing: a `<p>` (or a heading, a list, a quote) with the browser's default
// margins is set off by a blank line, the way a client draws it; one that
// sets its own margin (`margin:0`, as ours and Gmail's do) is not.

// ── the tree ────────────────────────────────────────────────────────────

interface El {
  kind: "el";
  name: string;
  attrs: Record<string, string>;
  children: Node[];
}
type Node = El | { kind: "text"; text: string };

/**
 * How deep the tree is built: an element opened deeper is not nested further
 * (its content joins the element at the limit), so a message of thousands of
 * unclosed tags reads as its text instead of overflowing the walk's stack.
 */
const MAX_DEPTH = 256;

function parseTree(html: string): { root: El; sheet: Sheet } {
  const root: El = { kind: "el", name: "#root", attrs: {}, children: [] };
  const stack: El[] = [root];
  /** Elements opened past the limit, not on `stack`: their close is skipped. */
  let flattened = 0;
  const styles: string[] = [];
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (stack.length > MAX_DEPTH) {
          flattened++;
          return;
        }
        const el: El = { kind: "el", name, attrs, children: [] };
        stack.at(-1)!.children.push(el);
        stack.push(el);
      },
      ontext(text) {
        const top = stack.at(-1)!;
        if (top.name === "style") styles.push(text);
        top.children.push({ kind: "text", text });
      },
      onclosetag(name) {
        if (flattened > 0) {
          flattened--;
          return;
        }
        const at = stack.findLastIndex((el) => el.name === name);
        if (at > 0) stack.length = at;
      },
    },
    {
      decodeEntities: true,
      lowerCaseTags: true,
      lowerCaseAttributeNames: true,
    },
  );
  parser.end(html);
  return { root, sheet: sheetOf(styles.join("\n")) };
}

// ── what an element is ──────────────────────────────────────────────────

/** Left out with everything in them: not drawn, or not content. */
const SKIPPED = new Set([
  "head",
  "title",
  "style",
  "script",
  "noscript",
  "template",
  "img",
  "svg",
  "video",
  "audio",
  "iframe",
  "object",
  "button",
  "input",
  "select",
  "textarea",
]);

/** Elements that end the line before them and after them. */
const BLOCKS = new Set([
  "div",
  "p",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "center",
  "address",
  "figure",
  "figcaption",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "caption",
  "dl",
  "dt",
  "dd",
  "form",
  "fieldset",
  "body",
  "html",
]);

/** Blocks a browser sets off with a margin unless their style sets one. */
const SPACED = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "blockquote",
  "pre",
  "dl",
  "figure",
]);

const MARK_TAGS: Record<string, Mark> = {
  b: "bold",
  strong: "bold",
  i: "italic",
  em: "italic",
  cite: "italic",
  u: "underline",
  ins: "underline",
  s: "strikethrough",
  strike: "strikethrough",
  del: "strikethrough",
  code: "code",
  tt: "code",
  kbd: "code",
  samp: "code",
};

const HEADINGS: Record<string, SerializedBlock["type"]> = {
  h1: "heading-1",
  h2: "heading-2",
  h3: "heading-3",
  h4: "heading-3",
  h5: "heading-3",
  h6: "heading-3",
};

/** The declarations of an inline `style`, lower-cased names. */
function styleOf(el: El): Map<string, string> {
  const out = new Map<string, string>();
  for (const decl of (el.attrs.style ?? "").split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    out.set(
      decl.slice(0, colon).trim().toLowerCase(),
      decl
        .slice(colon + 1)
        .replace(/!important/i, "")
        .trim()
        .toLowerCase(),
    );
  }
  return out;
}

const hidden = (style: Map<string, string>) =>
  style.get("display") === "none" ||
  style.get("visibility") === "hidden" ||
  /^0(px)?$/.test(style.get("max-height") ?? "") ||
  style.get("mso-hide") === "all";

const setsMarginIn = (decls: string) =>
  /(^|[;{\s])margin(-[a-z]+)?\s*:/i.test(decls);

/**
 * The selectors of the message's own `<style>` sheet that set a margin, in the
 * simple forms mail writes (`p`, `.x`, `p.x`): Outlook zeroes its paragraphs'
 * margins there (`p.MsoNormal{margin:0}`), not inline.
 */
interface Sheet {
  tags: ReadonlySet<string>;
  classes: ReadonlySet<string>;
  qualified: ReadonlySet<string>;
}

function sheetOf(css: string): Sheet {
  const tags = new Set<string>();
  const classes = new Set<string>();
  const qualified = new Set<string>();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    if (!setsMarginIn(rule[2]!)) continue;
    for (const raw of rule[1]!.split(",")) {
      const m = /^([a-z][a-z0-9]*)?(?:\.([\w-]+))?$/i.exec(raw.trim());
      if (!m || (!m[1] && !m[2])) continue;
      const tag = m[1]?.toLowerCase();
      const cls = m[2]?.toLowerCase();
      if (tag && cls) qualified.add(`${tag}.${cls}`);
      else if (tag) tags.add(tag);
      else classes.add(cls!);
    }
  }
  return { tags, classes, qualified };
}

/** Whether an element's margin is set, inline or by the message's sheet: it is not spaced the browser's way. */
function setsMargin(el: El, style: Map<string, string>, sheet: Sheet): boolean {
  if ([...style.keys()].some((k) => k === "margin" || k.startsWith("margin-")))
    return true;
  if (sheet.tags.has(el.name)) return true;
  for (const cls of (el.attrs.class ?? "").toLowerCase().split(/\s+/)) {
    if (cls === "") continue;
    if (sheet.classes.has(cls) || sheet.qualified.has(`${el.name}.${cls}`))
      return true;
  }
  return false;
}

// ── colours ─────────────────────────────────────────────────────────────

/** The CSS colour names mail uses, as hex (`<font color="red">`). */
const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  red: "#ff0000",
  darkred: "#8b0000",
  maroon: "#800000",
  orange: "#ffa500",
  darkorange: "#ff8c00",
  yellow: "#ffff00",
  gold: "#ffd700",
  green: "#008000",
  darkgreen: "#006400",
  lime: "#00ff00",
  olive: "#808000",
  teal: "#008080",
  blue: "#0000ff",
  navy: "#000080",
  darkblue: "#00008b",
  purple: "#800080",
  violet: "#ee82ee",
  magenta: "#ff00ff",
  fuchsia: "#ff00ff",
  pink: "#ffc0cb",
  hotpink: "#ff69b4",
  deeppink: "#ff1493",
  brown: "#a52a2a",
  chocolate: "#d2691e",
};

function rgbOf(value: string): [number, number, number] | null {
  const lower = value.trim().toLowerCase();
  const v = NAMED_COLORS[lower] ?? lower;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)?.[1];
  if (hex !== undefined) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
  }
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  return null;
}

type Hsl = [hue: number, saturation: number, lightness: number];

function hslOf([r, g, b]: [number, number, number]): Hsl {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === rr
      ? ((gg - bb) / d + 6) % 6
      : max === gg
        ? (bb - rr) / d + 2
        : (rr - gg) / d + 4;
  return [h * 60, s, l];
}

/** The chromatic tokens (gray is read from saturation alone). */
const TOKEN_HSL = Object.entries(EMAIL_TEXT_COLORS)
  .filter(([token]) => token !== "gray")
  .map(
    ([token, hex]) =>
      [token as Exclude<ColorToken, "default">, hslOf(rgbOf(hex)!)] as const,
  );

/**
 * A colour as the nearest text-colour token, by hue first (a sender's pure
 * #d00 is red, though far from our muted red in RGB), or `default` for what
 * reads as plain text: near black, a very light colour, an unparsed value.
 * A grey of middle lightness is `gray`.
 */
export function nearestColorToken(value: string): ColorToken {
  const rgb = rgbOf(value);
  if (rgb === null) return "default";
  const [h, s, l] = hslOf(rgb);
  if (l < 0.15 || l > 0.9) return "default";
  if (s < 0.15) return l < 0.35 ? "default" : "gray";
  let best: ColorToken = "default";
  let bestDistance = Infinity;
  for (const [token, [th, ts, tl]] of TOKEN_HSL) {
    const dh = Math.min(Math.abs(h - th), 360 - Math.abs(h - th));
    const d = dh / 60 + Math.abs(s - ts) * 0.5 + Math.abs(l - tl) * 1.5;
    if (d < bestDistance) {
      best = token;
      bestDistance = d;
    }
  }
  return best;
}

// ── the walk ────────────────────────────────────────────────────────────

/** What an element passes down: its formatting, and the message's sheet. */
interface Inline {
  sheet: Sheet;
  marks: ReadonlySet<Mark>;
  link?: string;
  color?: ColorToken;
}

/** A link a recipient may follow: web and mail addresses only. */
function safeHref(href: string | undefined): string | undefined {
  const h = href?.trim();
  return h !== undefined && /^(https?:|mailto:)/i.test(h) ? h : undefined;
}

function inlineOf(el: El, style: Map<string, string>, outer: Inline): Inline {
  const marks = new Set(outer.marks);
  let { link, color } = outer;
  const tagMark = MARK_TAGS[el.name];
  if (tagMark) marks.add(tagMark);
  const weight = style.get("font-weight");
  if (weight !== undefined) {
    if (/^(bold|bolder|[6-9]00)$/.test(weight)) marks.add("bold");
    else if (/^(normal|lighter|[1-4]00)$/.test(weight)) marks.delete("bold");
  }
  const fontStyle = style.get("font-style");
  if (fontStyle === "italic" || fontStyle === "oblique") marks.add("italic");
  else if (fontStyle === "normal") marks.delete("italic");
  const decoration =
    style.get("text-decoration") ?? style.get("text-decoration-line");
  if (decoration?.includes("underline")) marks.add("underline");
  if (decoration?.includes("line-through")) marks.add("strikethrough");
  if (el.name === "a") {
    link = safeHref(el.attrs.href);
    // A link's own colour is the sender's link style, not a colour written.
    return { sheet: outer.sheet, marks, link, color };
  }
  const written =
    style.get("color") ?? (el.name === "font" ? el.attrs.color : undefined);
  // `inherit` and its kin keep the colour around it.
  if (
    written !== undefined &&
    !/^(inherit|currentcolor|initial|unset|revert)$/i.test(written.trim())
  )
    color = nearestColorToken(written);
  return { sheet: outer.sheet, marks, link, color };
}

function runOf(text: string, inline: Inline): TextRun {
  const run: TextRun = { text };
  const marks = MARK_ORDER.filter((m) => inline.marks.has(m));
  if (marks.length > 0) run.marks = marks;
  if (inline.color !== undefined && inline.color !== "default")
    run.color = inline.color;
  if (inline.link !== undefined) run.link = inline.link;
  return run;
}

const textBlock = (runs: RichText): SerializedBlock => ({
  type: "text",
  data: { text: runs },
  expanded: true,
  children: [],
});

const isEmptyText = (b: SerializedBlock | undefined) =>
  b !== undefined &&
  b.type === "text" &&
  ((b.data as { text?: RichText }).text ?? []).length === 0;

/**
 * Where the walk writes: the blocks of one container (the document, a quote,
 * a list item's children) and the line being gathered. A list item's first
 * line is its own text (`head`), the lines after it its children.
 */
class Frame {
  line: TextRun[] | null = null;
  /** A blank line is owed before the next block (a spaced block ended or starts). */
  gap = false;
  constructor(
    readonly blocks: SerializedBlock[],
    readonly spaced: boolean,
    private head: SerializedBlock | null = null,
  ) {}

  /** Appends a block, after the blank line owed if any. */
  push(block: SerializedBlock): void {
    if (this.gap && this.spaced) {
      if (
        this.blocks.length > 0 &&
        !isEmptyText(this.blocks.at(-1)) &&
        !isEmptyText(block)
      )
        this.blocks.push(textBlock([]));
    }
    this.gap = false;
    this.blocks.push(block);
  }

  text(text: string, inline: Inline): void {
    let t = text.replace(/[ \t\n\r\f]+/g, " ");
    const prev = this.line?.at(-1)?.text;
    if (this.line === null || prev === undefined || prev.endsWith(" "))
      t = t.replace(/^ /, "");
    if (t === "") return;
    (this.line ??= []).push(runOf(t, inline));
  }

  /**
   * Ends the line being gathered. A line of collapsible whitespace is no
   * line; one of non-breaking spaces only is a blank line (`<p>&nbsp;</p>`,
   * how Outlook writes one). A non-breaking space is a space in the text.
   */
  flush(): void {
    const line = this.line;
    this.line = null;
    if (line === null) return;
    const last = line.at(-1)!;
    last.text = last.text.replace(/ +$/, "");
    if (line.every((r) => /^[ \u00a0]*$/.test(r.text))) {
      if (line.some((r) => r.text.includes("\u00a0"))) this.lineBreak();
      return;
    }
    for (const r of line) r.text = r.text.replace(/\u00a0/g, " ");
    const runs = coalesce(line);
    if (this.head !== null) {
      (this.head.data as { text: RichText }).text = runs;
      this.head = null;
      return;
    }
    this.push(textBlock(runs));
  }

  /** A `<br>`: ends the line, or — with none gathered — is a blank line itself. */
  lineBreak(): void {
    if (this.line !== null) this.flush();
    else if (this.head !== null) this.head = null;
    else this.push(textBlock([]));
  }

  /** Starts a block of its own: the line before it ends, the list item's head is given up. */
  block(block: SerializedBlock): void {
    this.flush();
    this.head = null;
    this.push(block);
  }
}

/** The text of a `<pre>`, as written (a `<br>` a newline). */
function preText(nodes: readonly Node[]): string {
  return nodes
    .map((n) =>
      n.kind === "text"
        ? n.text
        : n.name === "br"
          ? "\n"
          : SKIPPED.has(n.name)
            ? ""
            : preText(n.children),
    )
    .join("");
}

/** Trailing blank lines out of a container. */
function trimEnd(blocks: SerializedBlock[]): SerializedBlock[] {
  while (isEmptyText(blocks.at(-1))) blocks.pop();
  return blocks;
}

function walk(nodes: readonly Node[], frame: Frame, inline: Inline): void {
  for (const node of nodes) {
    if (node.kind === "text") {
      frame.text(node.text, inline);
      continue;
    }
    const el = node;
    if (SKIPPED.has(el.name)) continue;
    const style = styleOf(el);
    if (hidden(style)) continue;
    const spaced = SPACED.has(el.name) && !setsMargin(el, style, inline.sheet);
    const inner = inlineOf(el, style, inline);
    if (el.name === "br") {
      frame.lineBreak();
      continue;
    }
    if (el.name === "hr") {
      frame.block({ type: "divider", data: {}, expanded: true, children: [] });
      continue;
    }
    if (el.name === "pre") {
      frame.flush();
      if (spaced) frame.gap = true;
      frame.block({
        type: "code-block",
        data: {
          code: preText(el.children).replace(/^\n/, "").replace(/\n$/, ""),
        },
        expanded: true,
        children: [],
      });
      if (spaced) frame.gap = true;
      continue;
    }
    const heading = HEADINGS[el.name];
    if (heading !== undefined) {
      frame.flush();
      if (spaced) frame.gap = true;
      const runs: SerializedBlock[] = [];
      const sub = new Frame(runs, false);
      walk(el.children, sub, {
        ...inner,
        marks: new Set([...inner.marks].filter((m) => m !== "bold")),
      });
      sub.flush();
      const text = runs.flatMap((b) => {
        const t = (b.data as { text?: RichText }).text ?? [];
        return t.length === 0 ? [] : [t];
      });
      if (text.length > 0)
        frame.block({
          type: heading,
          data: {
            text: coalesce(
              text.flatMap((t, i) => (i === 0 ? t : [{ text: " " }, ...t])),
            ),
          },
          expanded: true,
          children: [],
        });
      if (spaced) frame.gap = true;
      continue;
    }
    if (el.name === "ul" || el.name === "ol") {
      frame.flush();
      if (spaced) frame.gap = true;
      const type = el.name === "ul" ? "bulleted-list" : "numbered-list";
      for (const child of el.children) {
        if (child.kind === "text") {
          if (child.text.trim() !== "")
            frame.block({
              type,
              data: { text: [{ text: child.text.trim() }] },
              expanded: true,
              children: [],
            });
          continue;
        }
        if (SKIPPED.has(child.name) || hidden(styleOf(child))) continue;
        // A list written straight inside its parent list (Gmail's editor:
        // `<ul><li>a</li><ul>…</ul></ul>`) nests under the item before it.
        const previous = frame.blocks.at(-1);
        if (
          (child.name === "ul" || child.name === "ol") &&
          previous?.type === type
        ) {
          const sub = new Frame(previous.children, false);
          walk([child], sub, inner);
          sub.flush();
          trimEnd(previous.children);
          continue;
        }
        const item: SerializedBlock = {
          type,
          data: { text: [] },
          expanded: true,
          children: [],
        };
        frame.block(item);
        const sub = new Frame(item.children, false, item);
        walk(
          child.name === "li" ? child.children : [child],
          sub,
          inlineOf(child, styleOf(child), inner),
        );
        sub.flush();
        trimEnd(item.children);
      }
      if (spaced) frame.gap = true;
      continue;
    }
    if (el.name === "blockquote") {
      frame.flush();
      if (spaced) frame.gap = true;
      const children: SerializedBlock[] = [];
      const sub = new Frame(children, true);
      walk(el.children, sub, inner);
      sub.flush();
      trimEnd(children);
      while (isEmptyText(children[0])) children.shift();
      if (children.length > 0)
        frame.block({ type: "quote", data: {}, expanded: true, children });
      if (spaced) frame.gap = true;
      continue;
    }
    if (BLOCKS.has(el.name)) {
      frame.flush();
      if (spaced) frame.gap = true;
      walk(el.children, frame, inner);
      frame.flush();
      if (spaced) frame.gap = true;
      continue;
    }
    walk(el.children, frame, inner);
  }
}

/**
 * An email's HTML as a document forest (`parseDocument`'s shape, document
 * blocks only): what `forestToEmailHtml` writes reads back as the forest it
 * was written from, and any other sender's HTML as the closest document —
 * see the header of this file for what is kept.
 */
export function emailHtmlToForest(html: string): SerializedBlock[] {
  const blocks: SerializedBlock[] = [];
  const frame = new Frame(blocks, true);
  const { root, sheet } = parseTree(html);
  walk(root.children, frame, { sheet, marks: new Set() });
  frame.flush();
  trimEnd(blocks);
  while (isEmptyText(blocks[0])) blocks.shift();
  return blocks;
}
