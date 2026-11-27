/**
 * Formatted text: plain text with a small, safe inline markup. The syntax
 * (documented in this plugin's CLAUDE.md):
 *
 * - `**bold**` — strong text; may hold key caps and links.
 * - `<kbd>⌘</kbd>` — a key cap; its content is literal text on one line.
 * - `[text](https://…)` — a link; `http(s)://`, `mailto:` or a site path
 *   (`/about`). Its text may hold bold and key caps.
 * - A newline is a line break; a blank line separates paragraphs.
 * - `\` before `\ * [ ] ( ) < >` writes that character literally.
 *
 * Nothing else is markup, and nothing is ever an error: a marker that does
 * not close, or a link to anything but the schemes above, stays literal text.
 * So any plain text is formatted text that reads the same, as long as it holds
 * none of the markers above.
 */

/** One run of a formatted text. A text run may hold `\n` (a line break). */
export type FormattedInline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly children: readonly FormattedInline[] }
  | { readonly kind: "key"; readonly text: string }
  | {
      readonly kind: "link";
      readonly href: string;
      readonly children: readonly FormattedInline[];
    };

/** A parsed formatted text: its runs in order (empty for an empty source). */
export type FormattedText = readonly FormattedInline[];

const ESCAPABLE = new Set(["\\", "*", "[", "]", "(", ")", "<", ">"]);
const KEY_OPEN = "<kbd>";
const KEY_CLOSE = "</kbd>";

/**
 * The link targets a formatted text may point at: the web, mail, or a path on
 * the same site. No backslash anywhere: a browser reads `\` as `/` in a web
 * URL, so `/\evil.com` would leave the site. A target ends at its first `)`
 * (write one inside a URL as `%29`).
 */
const SAFE_HREF =
  /^(?:https?:\/\/[^\s<>"\\]+|mailto:[^\s<>"\\]+|\/(?![/\\])[^\s<>"\\]*)$/;

export function isSafeFormattedHref(href: string): boolean {
  return SAFE_HREF.test(href);
}

interface Ctx {
  readonly strong: boolean;
  readonly link: boolean;
}

type Closer = "**" | "]" | null;

type SpanResult = { nodes: FormattedInline[]; end: number } | null;

/**
 * The span kinds (closer and context) one parse has already seen run to the
 * end of the text unclosed. A later opener of the same kind in the same
 * context has no closer left to find either, so it fails at once. Without
 * this, each opener re-scanned the rest of the text and the attempts nested in
 * it re-scanned again: cubic on `"**[ ".repeat(n)` (1.6 KB took seconds).
 */
type Unclosed = Set<string>;

function isSpace(c: string | undefined): boolean {
  return c === undefined || /\s/.test(c);
}

function push(nodes: FormattedInline[], text: string) {
  const last = nodes.at(-1);
  if (last?.kind === "text")
    nodes[nodes.length - 1] = { kind: "text", text: last.text + text };
  else nodes.push({ kind: "text", text });
}

/** A `**` at `i` that closes a bold: not at its start, right after a non-space. */
function closesStrong(src: string, i: number, start: number): boolean {
  return src.startsWith("**", i) && i > start && !isSpace(src[i - 1]);
}

/**
 * Parse from `start` up to `closer` (null: the end). Answers the runs and the
 * index after the closer, or null when the closer never comes — or an
 * enclosing span's closer comes first (spans nest properly or not at all).
 */
function parseSpan(
  src: string,
  start: number,
  closer: Closer,
  ctx: Ctx,
  unclosed: Unclosed,
): SpanResult {
  const kind = `${closer}|${ctx.strong}|${ctx.link}`;
  if (unclosed.has(kind)) return null;
  const result = scanSpan(src, start, closer, ctx, unclosed);
  if (result !== "unclosed") return result;
  unclosed.add(kind);
  return null;
}

/** `parseSpan`'s scan; "unclosed" when the text ends before the closer. */
function scanSpan(
  src: string,
  start: number,
  closer: Closer,
  ctx: Ctx,
  unclosed: Unclosed,
): SpanResult | "unclosed" {
  const nodes: FormattedInline[] = [];
  let i = start;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\" && ESCAPABLE.has(src[i + 1] ?? "")) {
      push(nodes, src[i + 1]!);
      i += 2;
      continue;
    }
    if (closer === "**" && closesStrong(src, i, start))
      return { nodes, end: i + 2 };
    if (closer === "]" && c === "]") return { nodes, end: i + 1 };
    // An enclosing span closes here first: this one is unclosed.
    if (ctx.link && closer !== "]" && c === "]") return null;
    if (ctx.strong && closer !== "**" && closesStrong(src, i, start))
      return null;

    if (!ctx.strong && src.startsWith("**", i) && !isSpace(src[i + 2])) {
      const inner = parseSpan(
        src,
        i + 2,
        "**",
        { ...ctx, strong: true },
        unclosed,
      );
      if (inner !== null && inner.nodes.length > 0) {
        nodes.push({ kind: "strong", children: inner.nodes });
        i = inner.end;
        continue;
      }
    }
    if (src.startsWith(KEY_OPEN, i)) {
      const close = src.indexOf(KEY_CLOSE, i + KEY_OPEN.length);
      const key = close < 0 ? "" : src.slice(i + KEY_OPEN.length, close);
      if (key.trim() !== "" && !/[\n<]/.test(key)) {
        nodes.push({ kind: "key", text: key });
        i = close + KEY_CLOSE.length;
        continue;
      }
    }
    if (!ctx.link && c === "[") {
      const label = parseSpan(
        src,
        i + 1,
        "]",
        { ...ctx, link: true },
        unclosed,
      );
      if (label !== null && label.nodes.length > 0 && src[label.end] === "(") {
        const close = src.indexOf(")", label.end + 1);
        const href = close < 0 ? "" : src.slice(label.end + 1, close);
        if (isSafeFormattedHref(href)) {
          nodes.push({ kind: "link", href, children: label.nodes });
          i = close + 1;
          continue;
        }
      }
    }
    push(nodes, c);
    i += 1;
  }
  return closer === null ? { nodes, end: i } : "unclosed";
}

/** Parse a formatted text's source. Total: every string parses. */
export function parseFormattedText(source: string): FormattedText {
  // `parseSpan` with no closer always answers.
  return parseSpan(source, 0, null, { strong: false, link: false }, new Set())!
    .nodes;
}

/** A plain text as a formatted text — one text run, no markup read. */
export function plainFormattedText(text: string): FormattedText {
  return text === "" ? [] : [{ kind: "text", text }];
}

/** What a formatted text reads as without its formatting: key caps as their key, links as their text. */
export function formattedPlainText(text: FormattedText): string {
  return text
    .map((n) =>
      n.kind === "text" || n.kind === "key"
        ? n.text
        : formattedPlainText(n.children),
    )
    .join("");
}
