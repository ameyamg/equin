/**
 * Inline markdown formatting shortcuts: the delimiter table, plus the two pure
 * consumers of it —
 *
 *  - `matchInlineFormat`, which decides whether the character the user just
 *    typed CLOSED a span (typing-time autoformat), and
 *  - `serializeInlineMarkdown` / `parseInlineMarkdown`, the whole-string
 *    `RichText` ⇄ markdown pair used by `markdown.ts` for clipboard export and
 *    paste. They are NOT expressible in terms of `matchInlineFormat`: it clamps
 *    to the caret's line and demands the closer at end-of-string, because it
 *    answers a different question.
 *
 * The table is plain data in `core/` rather than a slot because `Mark` is a
 * closed, persisted `z.enum` with a fixed `MARK_ORDER` (`rich-text.ts`) — a
 * sixth mark is a core edit plus a migration, never a contribution. Being data
 * in a leaf module is also what lets the *server* reuse it: `markdown.ts`'s
 * `MdSerializeCtx.md` renders `**`/`_`/`` ` `` on clipboard export through the
 * pair below, so a second copy of the delimiters there could drift from the one
 * the editor types against.
 *
 * This is a syntax layer ABOVE the persisted model, so it imports `Mark` /
 * `sortMarks` from `./rich-text` instead of being appended to it. Nothing here
 * touches Lexical or the DOM: the whole decision is a function of the line text
 * before the caret, which is what makes it `bun:test`-able with no editor
 * bootstrap (`inline-markdown.test.ts`).
 */

import {
  coalesce,
  COLOR_TOKENS,
  sortMarks,
  type ColorToken,
  type Mark,
  type RichText,
  type TextRun,
} from "./rich-text";

/** One delimiter row: `tag` wraps `marks`, symmetrically on both sides. */
export interface InlineSyntax {
  /** Delimiter, identical on both sides. */
  readonly tag: string;
  /** Applied together — `***` is bold AND italic, in one keystroke. */
  readonly marks: readonly Mark[];
  /**
   * `false` for the `_` family: CommonMark forbids intra-word `_` emphasis so
   * that `snake_case_name` and `x_1 y_2` stay literal. The `*` family has no
   * such restriction (`a*b*` genuinely emphasizes in CommonMark).
   */
  readonly intraword: boolean;
}

/**
 * Closed table, LONGEST TAG FIRST — the order `matchInlineFormat` tries rows
 * in, and therefore the precedence rule itself: `***x***` resolves as one
 * bold+italic row rather than `**` wrapping `*x*`.
 *
 * `"underline"` deliberately appears in NO row: markdown has no underline
 * syntax, so underline stays Cmd+U. Its absence is the proof that this table is
 * data — a mark can decline to declare a delimiter. `==highlight==` is absent
 * for the mirror-image reason: it has no corresponding `Mark`.
 */
export const INLINE_SYNTAXES: readonly InlineSyntax[] = [
  { tag: "***", marks: ["bold", "italic"], intraword: true },
  { tag: "___", marks: ["bold", "italic"], intraword: false },
  { tag: "**", marks: ["bold"], intraword: true },
  { tag: "__", marks: ["bold"], intraword: false },
  { tag: "~~", marks: ["strikethrough"], intraword: true },
  { tag: "`", marks: ["code"], intraword: true },
  { tag: "*", marks: ["italic"], intraword: true },
  { tag: "_", marks: ["italic"], intraword: false },
];

/**
 * Where the two delimiters sit and what to apply between them. Indices are
 * offsets into the LINE the caret is on (see `matchInlineFormat`'s clamp), so
 * the content span is `[openStart + tagLength, closeStart)`.
 */
export interface InlineFormatMatch {
  /** Index of the first char of the OPENING delimiter. */
  openStart: number;
  /** Index of the first char of the CLOSING delimiter. */
  closeStart: number;
  /** 1..3 — the matched row's `tag.length`. */
  tagLength: number;
  /** Canonically sorted via `sortMarks`, so it is storable as-is. */
  marks: Mark[];
}

/**
 * The two characters flanking the candidate, which the line text before the
 * caret cannot supply. Both are optional because "there is nothing there" (line
 * start / line end) is a legitimate, and permissive, answer.
 */
export interface InlineFormatContext {
  /** Char immediately before `textBefore` on the same line, or undefined at line start. */
  charBefore?: string;
  /** Char immediately after the caret on the same line, or undefined at line end. */
  charAfter?: string;
}

/**
 * The flanking-character class `@lexical/markdown` uses (ASCII punctuation plus
 * whitespace). Kept verbatim rather than re-derived: it is the CommonMark
 * "punctuation or space" flank test the `_`-family rules are specified against.
 */
const PUNCTUATION_OR_SPACE = /[!-/:-@[-`{-~\s]/;

const WHITESPACE = /\s/;

/**
 * The nearest-to-caret `tag` occurrence before `closeStart` that could open the
 * span, or `null` when the row has no opener.
 *
 * Scanning DOWNWARD (nearest first) is what makes `**a *b*` italicize just `b`
 * rather than reaching back past the bold delimiters. A candidate with
 * whitespace right after it is rejected — "a space after the opening delimiter
 * cancels it", so `** x**` does not bold — but that rejection must NOT abort the
 * row: an earlier position can still be a legal opener, so the scan continues.
 */
function findOpener(
  line: string,
  tag: string,
  closeStart: number,
): number | null {
  const d = tag.length;
  for (let start = closeStart - 1; start >= 0; start--) {
    if (!line.startsWith(tag, start)) continue;
    // `start <= closeStart - 1` ⇒ `start + d <= closeStart - 1 + d <= n - 1`, so
    // this read is always in range.
    if (WHITESPACE.test(line[start + d]!)) continue;
    return start;
  }
  return null;
}

/** How many `` ` `` chars precede `end` — odd means "inside an unclosed code span". */
function countBackticksBefore(line: string, end: number): number {
  let n = 0;
  for (let i = 0; i < end; i++) if (line[i] === "`") n += 1;
  return n;
}

/**
 * The inline format the just-typed character closed, or `null` when it closed
 * nothing.
 *
 * `textBefore` is the current line up to AND INCLUDING the just-typed character,
 * so the caret sits at `textBefore.length` and the typed char is the candidate
 * closer. `ctx` supplies the two chars this function cannot see (before the
 * fragment, after the caret).
 *
 * `null` is NOT an absorbed failure: "this keystroke closed nothing" is the
 * dominant legitimate outcome — it is the answer for nearly every keystroke the
 * user makes — exactly like `scanTrigger`/`findTrigger` in the caret-trigger
 * primitive. There is no failure mode to report; a malformed candidate and a
 * plain letter are the same non-event.
 */
export function matchInlineFormat(
  textBefore: string,
  ctx: InlineFormatContext = {},
): InlineFormatMatch | null {
  // Rule 0 — line clamp, DEFENSIVE. The real web caller never sees a "\n" here
  // (`runs-lexical.ts` materializes soft breaks as `LineBreakNode`s, so a
  // `TextNode`'s text never holds one), but a matcher that CAN span a line is a
  // latent corruption: the delimiters would sit in different visual lines and
  // the surgery would eat the break. Clamping to the last line makes it
  // structurally impossible; reported indices are in that clamped basis.
  const lastBreak = textBefore.lastIndexOf("\n");
  const line = lastBreak === -1 ? textBefore : textBefore.slice(lastBreak + 1);

  const n = line.length;
  if (n === 0) return null;
  const closeChar = line[n - 1]!;

  for (const row of INLINE_SYNTAXES) {
    const d = row.tag.length;
    const closeStart = n - d;

    // The line must END with this row's tag — the typed char closed it — with at
    // least one char before it (`>= 1`, not `>= 0`: something must precede the
    // closer for there to be an opener at all).
    if (closeStart < 1) continue;
    if (line.slice(closeStart) !== row.tag) continue;

    // `** x **` is not bold: whitespace immediately before the closer means the
    // user typed a literal, not a closing delimiter.
    if (WHITESPACE.test(line[closeStart - 1]!)) continue;

    // Right flank for the `_` family: `_x_y` must stay literal. Undefined
    // (caret at line end) is permissive.
    if (
      !row.intraword &&
      ctx.charAfter !== undefined &&
      !PUNCTUATION_OR_SPACE.test(ctx.charAfter)
    ) {
      continue;
    }

    const openStart = findOpener(line, row.tag, closeStart);
    if (openStart === null) continue;

    // Non-empty content, STRICT — and load-bearing twice over, not an obvious
    // guard. It is the single rule that makes `**` typable at all (an empty span
    // is what the user is halfway through typing), and it keeps the `` ` `` row
    // from claiming the third backtick of ` ``` ` — so the BLOCK-level
    // code-fence prefix stays reachable, with no coordination between the two
    // markdown layers.
    if (openStart + d >= closeStart) continue;

    // Repeating-char rule. While typing toward `**b**` the user passes through
    // `**b*`, whose `*` row would otherwise italicize `b` and eat the
    // delimiters mid-word. Rejecting when the char before the opener equals the
    // closing char makes that state inert, and is the same rule that stops `**`
    // from stealing `***`.
    if (openStart > 0 && line[openStart - 1] === closeChar) continue;

    // Left flank for the `_` family — the `snake_case_name` rule. At the start
    // of the fragment the answer comes from the caller's `charBefore`; undefined
    // (true line start) is permissive.
    if (!row.intraword) {
      const before = openStart > 0 ? line[openStart - 1] : ctx.charBefore;
      if (before !== undefined && !PUNCTUATION_OR_SPACE.test(before)) continue;
    }

    // Code-span precedence (CommonMark): an odd number of backticks before the
    // opener means we are INSIDE an unclosed code span, where nothing else
    // formats — so `` `a*b*c` `` stays literal until its own backtick closes it.
    // The code row itself is exempt: it is the thing doing the closing.
    if (
      !row.marks.includes("code") &&
      countBackticksBefore(line, openStart) % 2 === 1
    ) {
      continue;
    }

    return { openStart, closeStart, tagLength: d, marks: sortMarks(row.marks) };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Whole-string `RichText` ⇄ inline markdown
// ---------------------------------------------------------------------------
//
// THE ESCAPING RULE, stated once (both directions implement exactly this):
//
//   On serialize, every literal occurrence of one of
//
//        \  *  _  ~  `  [  ]  <
//
//   is prefixed with a backslash, and a literal SOFT LINE BREAK is written as
//   the two characters `\n`. Those eight are precisely the characters that can
//   BEGIN a construct this parser recognizes — a delimiter row's tag
//   (`*`, `_`, `~`, `` ` ``), a link (`[`, with `]` closing its text), a tag
//   (`<`) — plus the escape character itself; the break joins them as the one
//   character the scan may never SEE. So an escape is a SPELLING, not a
//   character repeated: on parse, a backslash followed by one of those
//   spellings yields what it spells, and a backslash followed by anything else
//   is a literal backslash (CommonMark's rule, restricted to the set we own).
//   The eight spell themselves; the break is the one that does not, and
//   `ESCAPES` below is the single table both directions read.
//
//   THE BREAK NEEDS A SPELLING because the guards further down abandon a
//   construct at a real newline — `matchLink`, `matchCodeSpan` and
//   `pairEmphasis` (a pair never spans a line) — so a link or a mark
//   straddling a break would be silently dropped, and because one block's text has to stay ONE markdown
//   line or `markdown.ts` fans it out into lines indistinguishable from sibling
//   blocks. Those guards stay exactly as they are: the escape is what makes
//   them unreachable from our own output rather than something to relax.
//
//   EMITTING a break as a real newline is a dialect the caller chooses
//   (`MarkdownContext.softBreaks`), for a document a person will read in
//   another app. DECODING is not a dialect — `\n` yields a break in both — since
//   the document we emit has to read back. The cost of that asymmetry, stated
//   rather than hidden: a lone `\n` in FOREIGN pasted markdown now means a
//   break where it used to mean two literal characters, so `C:\new` gains one,
//   and so does `` `printf "a\n"` `` (escapes resolve inside a code span too,
//   see `scanSpan`). That is the same leniency cost this module already accepts
//   and pins for `\*` inside a code span, and it is the price of the escape.
//
//   Nothing else is escaped: `(`, `)`, `>`, `#` and `-` carry no INLINE meaning
//   here, and block-level syntax is `markdown.ts`'s concern. Inside a URL the
//   set is narrower — `\` and `)` only — because a URL is read verbatim up to
//   its first unescaped `)`.
//
//   THE LINE-LEADING ESCAPE LIVES IN `markdown.ts`, AND MUST NOT MOVE HERE. A
//   paragraph whose text opens with another block type's marker (`3. x`, `- x`,
//   `---`) is spelled with one backslash at index 0 of the LINE, put there and
//   taken off by the block walk. This table cannot express that: it is
//   per-character and position-blind, so adding `-` to it would emit
//   `well\-known` for every hyphen in every word of every document. A POSITION
//   is what makes that escape exact, and a position is a fact about a line —
//   which is why the two layers are disjoint by construction (none of `3`, `-`,
//   `+`, `#`, `>`, `$` is a spelling below, so this scan never sees the block
//   escape and never double-decodes it).
//
// PROTECTED SPANS (`\(latex\)`, `[[page:…]]`, `[[date:…]]`, …) are matched
// FIRST and masked out of the scan in both directions: their bytes are emitted
// verbatim on serialize (never escaped) and taken verbatim on parse (never
// scanned for delimiters). Inline LaTeX is full of `_` and `*`, which is the
// whole reason this parameter exists. A protected span becomes its OWN run
// carrying no marks and no color — byte-for-byte what `runs-lexical.ts`'s
// `walkNode` produces for a decorator node — though it does inherit an enclosing
// link, as that walk does too.
//
// CANONICAL OUTPUT, and the identity it buys: a delimiter may never flank
// whitespace (`matchInlineFormat`'s two whitespace rules, mirrored below so what
// the user can TYPE and what pasted text PARSES as cannot diverge), so the
// serializer HOISTS boundary whitespace out of every delimiter-marked group
// first — `**a **` is emitted as `**a** `. That is invisible when rendered (a
// mark on a space paints nothing) and makes the round trip exact:
//
//     parseInlineMarkdown(serializeInlineMarkdown(runs, p), p) === canonical(runs)
//
// where `canonical` is `coalesce`, plus that hoist, plus splitting a protected
// span off into its own unmarked run — and is the identity on anything the
// editor produces from a selection that does not straddle a space, because that
// is exactly the shape `runs-lexical.ts` reads back out of Lexical.
//
// TOUCHING DELIMITERS are the one place the emitted string is not locally
// obvious: nested marks ending together (`**a*b***`), sibling marks of one
// character (`**a***b*`) and an escaped literal beside a delimiter
// (`**a \***`). The parser reads delimiter RUNS and pairs their characters by
// count (`pairEmphasis`), so each of those reads back; the fuzzed round trip in
// `inline-markdown.test.ts` is what pins it for every run sequence.

/**
 * Whether a token family's bytes must be MASKED from the inline scan.
 *
 * This is NOT the same question as "where is my token", even though one regex
 * answers both and that is exactly why they were one field for a while. A token
 * family declares two independent things:
 *
 *  - its **locator** (`pattern`) — how to FIND its token in a line, so it can be
 *    built, serialized and re-materialized. Every token family has one, always.
 *  - its **markdown span** (this) — whether the marks-aware inline scan
 *    (`parseInlineMarkdown` / `serializeInlineMarkdown`) must be told to leave
 *    those bytes alone. Only some families need it.
 *
 * Masking is NOT free, which is the whole reason it is a separate statement: a
 * masked span becomes its OWN run carrying NO MARKS (`scanSpan`'s mask branch),
 * because a decorator node cannot wear a `code` or `bold` mark. So protecting a
 * span that did not need it silently DELETES the marks a person put on it —
 * `` `att-1787654245-y41m` `` parses as an unmarked run instead of a code-marked
 * one, and the id a person wrote as documentation comes back as a live widget.
 *
 *  - `"protect"` — the token text can contain characters the inline scan reads
 *    as syntax (`_ * ~ \` [ ] < \\`), so leaving the scan to run over it
 *    CORRUPTS the token. `\(a_1 * b\)` and `[[page:…]]` are the shape: inline
 *    LaTeX is full of `_` and `*`, and a page link is made of brackets.
 *    A `"protect"` pattern MUST NOT match across a line break. Its bytes are
 *    emitted verbatim — the escaping rule above cannot reach inside a masked
 *    span — so a token straddling a break has no one-line spelling, and the
 *    escaped dialect's assert in {@link serializeInlineMarkdown} is what turns
 *    that from silent corruption into a named crash. The three registered
 *    families all exclude `\n` today; this is the statement that they must.
 *  - `"transparent"` — the token text is markdown-inert (a bare id is digits,
 *    lowercase letters and hyphens), so the scan running over it changes
 *    nothing, and masking it would only cost the span its marks.
 *
 * Required, never defaulted: the two failure modes point opposite ways (an
 * unprotected LaTeX token is corrupted; an over-protected id loses its marks),
 * so there is no safe default to fall back on — the family that owns the bytes
 * is the only one that knows.
 */
export type MarkdownSpan = "protect" | "transparent";

/**
 * What an inline code span holding EXACTLY one of a token family's tokens
 * means in text an AGENT writes to a page — an `edit_page` `new_string`, a
 * `write_agent_note` body.
 *
 * Agents style every identifier as inline code (`` `task-1791474346624-bc04eo` ``),
 * out of the same habit that has them write `` `foo.ts` ``. For a bare id that
 * is not a statement that the id is verbatim text: the agent named a task, and
 * the reader wants its chip — what the same id becomes when a person pastes it,
 * and what an agent's backticked id already renders as in a transcript (the
 * markdown enhancer chips inline code). So a family states, once, which reading
 * its token takes in an agent's page write:
 *
 *  - `"token"` — the backticks go and the token lands as itself (the chip).
 *    Right for a bare id, whose only spelling is the id.
 *  - `"verbatim"` — the span stays code. Right for a token with a SYNTAX
 *    (`[[page:…]]`, `\(latex\)`): an agent backticking one is documenting
 *    that syntax.
 *
 * About agent text only, and only text the write INTRODUCES (see
 * `unwrapAgentCodeSpans`): a person who backticks an id in the page editor
 * keeps their code span ({@link MarkdownSpan}'s and `token-scan`'s `code`
 * rule) — there it is a deliberate act, here a habit. Required, never
 * defaulted: the two kinds of family want opposite answers, and only the
 * family that owns the bytes knows which it is.
 */
export type AgentCodeSpan = "token" | "verbatim";

/**
 * Stand-in character for a protected span's bytes while scanning. NUL cannot
 * appear in a delimiter tag, a link, or a tag name, so every `startsWith` test
 * fails inside a masked region BY CONSTRUCTION rather than by a range check
 * every call site would have to remember.
 */
const MASK = "\u0000";

/**
 * How a soft line break inside a run is EMITTED — see THE ESCAPING RULE above.
 * Serialize-only in every sense: the parse side decodes `\n` unconditionally.
 */
export type SoftBreaks = "escaped" | "newline";

/**
 * THE ESCAPE TABLE — see THE ESCAPING RULE above. One row per escapable
 * character: the LITERAL a run holds, and the SPELLING written after the
 * backslash. Both directions are derived from it, so an escape this module
 * emits and an escape it reads back cannot come from two lists.
 *
 * Eight rows spell themselves; the soft break is the first whose spelling is a
 * transform, because the character it stands for is the one the scan may never
 * see.
 */
const ESCAPES: readonly (readonly [literal: string, spelling: string])[] = [
  ["\\", "\\"],
  ["*", "*"],
  ["_", "_"],
  ["~", "~"],
  ["`", "`"],
  ["[", "["],
  ["]", "]"],
  ["<", "<"],
  ["\n", "n"],
];

/**
 * Literal character → its spelling, per dialect. `"newline"` simply drops the
 * break's row: a character with no spelling is emitted as itself, which for the
 * break is the real newline that dialect exists to produce.
 */
const SPELLING_OF: Record<SoftBreaks, ReadonlyMap<string, string>> = {
  escaped: new Map(ESCAPES),
  newline: new Map(ESCAPES.filter(([literal]) => literal !== "\n")),
};

/** Spelling → the literal it yields. ONE table, read in both dialects. */
const LITERAL_OF: ReadonlyMap<string, string> = new Map(
  ESCAPES.map(([literal, spelling]) => [spelling, literal] as const),
);

/**
 * Marks that have a delimiter row, i.e. the ones whose group boundaries are
 * whitespace-sensitive. Derived from the table so it cannot drift from it
 * (today: everything but `underline`, which is tag-wrapped and therefore safe).
 */
const DELIMITED_MARKS = new Set<Mark>(
  INLINE_SYNTAXES.flatMap((row) => [...row.marks]),
);

/**
 * `text` with every `protectedSpans` match replaced by `MASK` repeated to the
 * SAME length, so indices into the mask and into the original text share one
 * basis and no caller has to translate between them.
 *
 * ONE left-to-right tokenizer over every family: at each position the first
 * pattern that matches there (in the given order) takes the token, and the scan
 * resumes after it — so no match ever starts inside another token. Masking each
 * family independently let one token's bytes open another (the `\(` inside
 * `[[page:~\(]]` starting a LaTeX span that a link href's `\)` closed), which
 * the serializer, seeing that token alone in its run, never wrote. A pattern is
 * re-created sticky from `.source`; a zero-length match takes nothing.
 */
function maskProtected(
  text: string,
  protectedSpans: RegExp[],
  spelled?: Uint8Array,
): string {
  if (protectedSpans.length === 0 || text.length === 0) return text;
  const sticky = protectedSpans.map((p) => new RegExp(p.source, "y"));
  let out = "";
  let i = 0;
  while (i < text.length) {
    // A token never STARTS at a character an escape spells: that character
    // is literal text the serializer escaped (see `scanOf`).
    let end = -1;
    if (spelled?.[i] !== 1) {
      for (const re of sticky) {
        re.lastIndex = i;
        const m = re.exec(text);
        if (m && m[0].length > 0) {
          end = i + m[0].length;
          break;
        }
      }
    }
    if (end === -1) {
      out += text[i]!;
      i += 1;
    } else {
      out += MASK.repeat(end - i);
      i = end;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Serialize: runs → markdown
// ---------------------------------------------------------------------------

/** One wrapping construct around a contiguous run range. */
interface Wrapper {
  /** Identity for "is this already applied by an enclosing wrapper". */
  key: string;
  open: string;
  close: string;
}

/**
 * Nesting order for the delimiter marks, OUTERMOST FIRST — the one decision this
 * has to state (see `wrappersOf` for why `code` must stay last). The delimiters
 * themselves are read off the table, so only the ORDER lives here; a row's tag
 * cannot drift from a second copy. `inline-markdown.test.ts` pins that this
 * covers every delimited mark.
 */
const MARK_NESTING: readonly Mark[] = [
  "bold",
  "italic",
  "strikethrough",
  "code",
];

/** `(mark, its single-mark row's tag)` in `MARK_NESTING` order. */
const MARK_TAGS: readonly (readonly [Mark, string])[] = MARK_NESTING.flatMap(
  (mark) => {
    const row = INLINE_SYNTAXES.find(
      (r) => r.marks.length === 1 && r.marks[0] === mark,
    );
    return row ? [[mark, row.tag] as const] : [];
  },
);

/** Backslash-escape a URL's `\` and `)` (see THE ESCAPING RULE). */
function escapeUrl(url: string): string {
  return url.replace(/[\\)]/g, (c) => `\\${c}`);
}

/** Apply THE ESCAPING RULE to literal text, leaving protected spans verbatim. */
function escapeText(
  text: string,
  protectedSpans: RegExp[],
  softBreaks: SoftBreaks,
): string {
  const spellingOf = SPELLING_OF[softBreaks];
  const masked = maskProtected(text, protectedSpans);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (masked[i] === MASK) {
      out += c;
      continue;
    }
    const spelling = spellingOf.get(c);
    out += spelling === undefined ? c : `\\${spelling}`;
  }
  return out;
}

/**
 * The wrappers a run needs, OUTERMOST FIRST. The order is the nesting order and
 * is load-bearing twice over: `bold` before `italic` is what makes a bold+italic
 * run emit `***x***` (which the table's longest-tag-first parse reads back as
 * ONE row rather than two nested spans), and `code` LAST is what keeps a code
 * span innermost — its content is parsed verbatim, so a delimiter emitted inside
 * one would never be read back.
 */
function wrappersOf(run: TextRun): Wrapper[] {
  const out: Wrapper[] = [];
  if (run.link) {
    out.push({
      key: `link:${run.link}`,
      open: "[",
      close: `](${escapeUrl(run.link)})`,
    });
  }
  if (run.color && run.color !== "default") {
    out.push({
      key: `color:${run.color}`,
      open: `<color value="${run.color}">`,
      close: "</color>",
    });
  }
  const marks = new Set(run.marks ?? []);
  // `underline` is the one mark markdown has no delimiter for, so it gets a tag.
  if (marks.has("underline")) {
    out.push({ key: "mark:underline", open: "<u>", close: "</u>" });
  }
  for (const [mark, tag] of MARK_TAGS) {
    if (marks.has(mark))
      out.push({ key: `mark:${mark}`, open: tag, close: tag });
  }
  return out;
}

/**
 * Split leading / trailing whitespace off every delimiter-marked run, so no
 * emitted delimiter ever flanks a space (see CANONICAL OUTPUT above). The
 * whitespace keeps the run's tag-wrapped attributes (underline / color / link),
 * which are whitespace-safe; only the delimiter marks are dropped from it.
 */
function hoistBoundaryWhitespace(runs: RichText): RichText {
  const out: RichText = [];
  for (const run of runs) {
    const marks = run.marks ?? [];
    if (!marks.some((m) => DELIMITED_MARKS.has(m))) {
      out.push(run);
      continue;
    }
    const leadLen = run.text.length - run.text.trimStart().length;
    const trailLen =
      leadLen === run.text.length
        ? 0
        : run.text.length - run.text.trimEnd().length;
    if (leadLen === 0 && trailLen === 0) {
      out.push(run);
      continue;
    }
    const lead = run.text.slice(0, leadLen);
    const trail =
      trailLen === 0 ? "" : run.text.slice(run.text.length - trailLen);
    const core = run.text.slice(leadLen, run.text.length - trailLen);
    const kept = marks.filter((m) => !DELIMITED_MARKS.has(m));
    const bare = (text: string): TextRun => ({
      text,
      ...(kept.length > 0 ? { marks: kept } : {}),
      ...(run.color ? { color: run.color } : {}),
      ...(run.link ? { link: run.link } : {}),
    });
    if (lead.length > 0) out.push(bare(lead));
    if (core.length > 0) out.push({ ...run, text: core });
    if (trail.length > 0) out.push(bare(trail));
  }
  return coalesce(out);
}

/**
 * Split every protected span into its OWN run, dropping the marks and colour the
 * surrounding run carried (an enclosing link is kept — `walkNode` keeps it too).
 * This is the serialize-side statement of the same rule the parser applies: a
 * decorator token is never marked, so a mark may not span one. Without it the
 * round trip still converges, but takes two cycles instead of one.
 */
function splitProtectedSpans(
  runs: RichText,
  protectedSpans: RegExp[],
): RichText {
  if (protectedSpans.length === 0) return runs;
  const out: RichText = [];
  for (const run of runs) {
    const masked = maskProtected(run.text, protectedSpans);
    let i = 0;
    let plainFrom = 0;
    const pushPlain = (end: number): void => {
      if (end > plainFrom)
        out.push({ ...run, text: run.text.slice(plainFrom, end) });
    };
    while (i < masked.length) {
      if (masked[i] !== MASK) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < masked.length && masked[j] === MASK) j += 1;
      pushPlain(i);
      out.push(
        run.link
          ? { text: run.text.slice(i, j), link: run.link }
          : { text: run.text.slice(i, j) },
      );
      plainFrom = j;
      i = j;
    }
    pushPlain(run.text.length);
  }
  return coalesce(out);
}

/**
 * Greedy maximal grouping: take the outermost wrapper the first run still needs,
 * extend it over every following run that also needs it, and emit it ONCE around
 * the recursively-emitted range. The runs themselves stay FLAT — marks are a
 * per-run set, never a tree; the nesting exists only in the emitted string.
 */
function emitRuns(
  runs: RichText,
  applied: Set<string>,
  protectedSpans: RegExp[],
  softBreaks: SoftBreaks,
): string {
  const pendingOf = (run: TextRun): Wrapper[] =>
    wrappersOf(run).filter((w) => !applied.has(w.key));
  let out = "";
  let i = 0;
  while (i < runs.length) {
    const pending = pendingOf(runs[i]!);
    if (pending.length === 0) {
      out += escapeText(runs[i]!.text, protectedSpans, softBreaks);
      i += 1;
      continue;
    }
    const wrapper = pending[0]!;
    // `code` is LAST in `wrappersOf`'s order, so reaching it as the outermost
    // pending wrapper means it is the only one left on this run — and the group
    // may only extend over runs that are likewise code-and-nothing-else, since a
    // code span's content is parsed verbatim.
    const codeOnly = wrapper.key === "mark:code";
    let j = i + 1;
    while (j < runs.length) {
      const next = pendingOf(runs[j]!);
      if (!next.some((w) => w.key === wrapper.key)) break;
      if (codeOnly && next.length !== 1) break;
      j += 1;
    }
    applied.add(wrapper.key);
    out +=
      wrapper.open +
      emitRuns(runs.slice(i, j), applied, protectedSpans, softBreaks) +
      wrapper.close;
    applied.delete(wrapper.key);
    i = j;
  }
  return out;
}

/**
 * Render runs as canonical inline markdown: marks as delimiters, `link` as
 * `[text](url)`, `color` as `<color value="…">`, `underline` as `<u>`, every
 * literal delimiter character backslash-escaped, a soft break spelled per
 * `softBreaks`, and every `protectedSpans` match emitted verbatim. Round-trips
 * through {@link parseInlineMarkdown} — see the section header for the exact
 * statement.
 *
 * In the `"escaped"` dialect the result is ONE LINE, and this asserts it. The
 * escaping rule cannot reach the two places a newline is emitted VERBATIM — a
 * `link` href (`escapeUrl` escapes only `\` and `)`, and `matchLink` would then
 * fail to read the link back) and a `"protect"` span whose pattern matched
 * across a break. Both are silent corruption otherwise: fix-ladder rung 4, for
 * the leak no type can see.
 */
export function serializeInlineMarkdown(
  runs: RichText,
  protectedSpans: RegExp[],
  softBreaks: SoftBreaks,
): string {
  const canonical = hoistBoundaryWhitespace(
    splitProtectedSpans(coalesce(runs), protectedSpans),
  );
  const out = emitRuns(canonical, new Set(), protectedSpans, softBreaks);
  if (softBreaks === "escaped" && out.includes("\n")) {
    const culprit = canonical.find(
      (run) => run.text.includes("\n") || (run.link?.includes("\n") ?? false),
    );
    throw new Error(
      "serializeInlineMarkdown: the escaped dialect emits one line, but a raw " +
        "newline survived. Run text is spelled `\\n`, so this came from bytes " +
        "emitted verbatim — a `link` href holding a newline, or a `protect` " +
        "span whose pattern matched across one (see `MarkdownSpan`). Offending " +
        `run: ${JSON.stringify(culprit?.text ?? out)}`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parse: markdown → runs
// ---------------------------------------------------------------------------

/** The two strings the scan reads, in one shared index basis. */
interface Scan {
  text: string;
  masked: string;
  /** 1 where the character is the one an escape spells (`*` in `\\*`). */
  escaped: Uint8Array;
}

/** Attributes accumulated by the enclosing wrappers at the current scan depth. */
interface ScanAttrs {
  marks: Mark[];
  color?: ColorToken;
  link?: string;
}

function runWith(text: string, attrs: ScanAttrs): TextRun {
  const run: TextRun = { text };
  if (attrs.marks.length > 0) run.marks = sortMarks(attrs.marks);
  if (attrs.color) run.color = attrs.color;
  if (attrs.link) run.link = attrs.link;
  return run;
}

/** `s.text[i]` starts a backslash escape that consumes `s.text[i + 1]`. */
function isEscapeAt(s: Scan, i: number, to: number): boolean {
  if (s.text[i] !== "\\" || s.masked[i] === MASK) return false;
  return (
    i + 1 < to && s.masked[i + 1] !== MASK && LITERAL_OF.has(s.text[i + 1]!)
  );
}

/**
 * The character the escape at `i` YIELDS — `\n` is a soft break, everything
 * else spells itself. Beside {@link isEscapeAt} on purpose: "does an escape
 * start here" and "what does it produce" read the same table, so the lookup is
 * total exactly where that predicate just said yes, which is what the two
 * assertions here rest on. Three of `isEscapeAt`'s four callers only SKIP the
 * pair; this is for the one that emits.
 */
function escapedCharAt(s: Scan, i: number): string {
  return LITERAL_OF.get(s.text[i + 1]!)!;
}

/** A tag construct: `<u>…</u>` or `<color value="…">…</color>`. */
interface TagSyntax {
  name: string;
  open: RegExp;
  /** The attributes it contributes, or null when the match is not valid. */
  attrs(match: RegExpExecArray): Partial<ScanAttrs> | null;
}

const TAG_SYNTAXES: readonly TagSyntax[] = [
  { name: "u", open: /^<u>/, attrs: () => ({ marks: ["underline"] }) },
  {
    name: "color",
    open: /^<color value="([a-z]+)">/,
    attrs: (m) => {
      const value = m[1]! as ColorToken;
      // An unrecognized colour is not a failure — parsing foreign markdown is
      // lenient, so the tag simply stays literal text.
      return COLOR_TOKENS.includes(value) && value !== "default"
        ? { color: value }
        : null;
    },
  },
];

/** Index of the `</name>` closing the `<name…>` opened before `from`, or null. */
function findTagClose(
  s: Scan,
  from: number,
  to: number,
  name: string,
): number | null {
  const close = `</${name}>`;
  const openPrefix = `<${name}`;
  let depth = 1;
  let j = from;
  while (j < to) {
    if (s.masked[j] === MASK) {
      j += 1;
      continue;
    }
    if (isEscapeAt(s, j, to)) {
      j += 2;
      continue;
    }
    if (j + close.length <= to && s.text.startsWith(close, j)) {
      depth -= 1;
      if (depth === 0) return j;
      j += close.length;
      continue;
    }
    if (j + openPrefix.length <= to && s.text.startsWith(openPrefix, j)) {
      depth += 1;
      j += openPrefix.length;
      continue;
    }
    j += 1;
  }
  return null;
}

interface TagMatch {
  attrs: Partial<ScanAttrs>;
  contentStart: number;
  contentEnd: number;
  end: number;
}

function matchTag(s: Scan, i: number, to: number): TagMatch | null {
  const rest = s.text.slice(i, to);
  for (const syntax of TAG_SYNTAXES) {
    const m = syntax.open.exec(rest);
    if (!m) continue;
    const attrs = syntax.attrs(m);
    if (attrs === null) continue;
    const contentStart = i + m[0].length;
    const closeAt = findTagClose(s, contentStart, to, syntax.name);
    if (closeAt === null) continue;
    return {
      attrs,
      contentStart,
      contentEnd: closeAt,
      end: closeAt + `</${syntax.name}>`.length,
    };
  }
  return null;
}

interface LinkMatch {
  textStart: number;
  textEnd: number;
  url: string;
  end: number;
}

/** `[text](url)` starting at `i`, or null when this `[` opens no link. */
function matchLink(s: Scan, i: number, to: number): LinkMatch | null {
  let depth = 1;
  let j = i + 1;
  while (j < to) {
    if (s.masked[j] === MASK) {
      j += 1;
      continue;
    }
    if (isEscapeAt(s, j, to)) {
      j += 2;
      continue;
    }
    const c = s.text[j]!;
    if (c === "\n") return null;
    if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
    j += 1;
  }
  if (j >= to || depth !== 0) return null;
  const closeBracket = j;
  // Empty link text would swallow the brackets and leave nothing behind.
  if (closeBracket === i + 1) return null;
  if (closeBracket + 1 >= to || s.text[closeBracket + 1] !== "(") return null;

  let k = closeBracket + 2;
  let url = "";
  while (k < to) {
    const c = s.text[k]!;
    if (c === "\n") return null;
    if (c === "\\" && k + 1 < to) {
      url += s.text[k + 1]!;
      k += 2;
      continue;
    }
    if (c === ")") break;
    url += c;
    k += 1;
  }
  if (k >= to || s.text[k] !== ")") return null;
  // An empty URL is not a link — stay literal rather than eat the brackets.
  if (url.length === 0) return null;
  return { textStart: i + 1, textEnd: closeBracket, url, end: k + 1 };
}

/** The code row: its content is verbatim, so it is matched as one construct. */
const CODE_SYNTAX: InlineSyntax = (() => {
  const row = INLINE_SYNTAXES.find((r) => r.marks.includes("code"));
  if (!row || row.tag.length !== 1 || row.marks.length !== 1) {
    throw new Error(
      "inline-markdown: the code row must be a one-character tag carrying only `code`",
    );
  }
  return row;
})();

/**
 * Every EMPHASIS row (everything but code), by its delimiter character, longest
 * tag first. A row is a number of that character: `**` is two `*`, and a run of
 * delimiters pairs by COUNTING its characters — see {@link pairEmphasis}.
 */
const EMPHASIS_ROWS: ReadonlyMap<string, readonly InlineSyntax[]> = (() => {
  const byChar = new Map<string, InlineSyntax[]>();
  for (const row of INLINE_SYNTAXES) {
    if (row === CODE_SYNTAX) continue;
    const char = row.tag[0]!;
    if (row.tag !== char.repeat(row.tag.length)) {
      throw new Error(
        `inline-markdown: emphasis tag ${JSON.stringify(row.tag)} must repeat one character`,
      );
    }
    const rows = byChar.get(char) ?? [];
    if (rows.some((r) => r.intraword !== row.intraword)) {
      throw new Error(
        `inline-markdown: every ${JSON.stringify(char)} row must agree on intraword`,
      );
    }
    rows.push(row);
    byChar.set(char, rows);
  }
  for (const rows of byChar.values())
    rows.sort((a, b) => b.tag.length - a.tag.length);
  return byChar;
})();

/**
 * `s.text[k]` is a delimiter character `char` that is SYNTAX-capable: not masked
 * and not the character an escape spells. An escaped `\*` is a literal star, so
 * it neither joins a delimiter run nor breaks the run rules around one — the
 * whole reason the scan records `escaped`.
 */
function isDelimCharAt(s: Scan, k: number, char: string): boolean {
  return (
    k >= 0 &&
    k < s.text.length &&
    s.text[k] === char &&
    s.masked[k] !== MASK &&
    s.escaped[k] !== 1
  );
}

interface CodeMatch {
  contentStart: number;
  contentEnd: number;
  end: number;
}

/**
 * The code span opening at `i`, or null. A code span is a single construct
 * (its content verbatim), matched left to right BEFORE emphasis — CommonMark's
 * precedence. Its delimiters follow the whole-run rule (a backtick touching
 * either delimiter on the outside or the inside cancels it), no whitespace
 * inside either delimiter, non-empty content; escapes resolve inside it.
 */
function matchCodeSpan(s: Scan, i: number, to: number): CodeMatch | null {
  const tag = CODE_SYNTAX.tag;
  const d = tag.length;
  if (!isDelimCharAt(s, i, tag)) return null;
  if (i + d >= to) return null;
  if (WHITESPACE.test(s.text[i + d]!)) return null;
  if (isDelimCharAt(s, i + d, tag)) return null;
  if (isDelimCharAt(s, i - 1, tag)) return null;
  for (let j = i + d; j + d <= to; j++) {
    if (s.text[j] === "\n") return null;
    if (s.masked[j] === MASK) continue;
    if (isEscapeAt(s, j, to)) {
      j += 1;
      continue;
    }
    if (!isDelimCharAt(s, j, tag)) continue;
    if (j === i + d) continue;
    if (WHITESPACE.test(s.text[j - 1]!)) continue;
    if (isDelimCharAt(s, j + d, tag)) continue;
    return { contentStart: i + d, contentEnd: j, end: j + d };
  }
  return null;
}

/**
 * A maximal run of one emphasis character, and what it may do. The run is the
 * unit CommonMark reasons about: `***` after `b` in `**a*b***` is ONE run, of
 * which the first `*` closes the italic and the last two the bold.
 */
interface DelimRun {
  char: string;
  start: number;
  /** The run's length as written. */
  length: number;
  /** Characters not yet paired: `[lo, hi)`. A closer pairs from `lo`, an opener from `hi`. */
  lo: number;
  hi: number;
  canOpen: boolean;
  canClose: boolean;
  /** Real newlines before it: a pair never spans a line. */
  line: number;
  /** Cleared when a pair forms around it (CommonMark's "remove from the stack"). */
  active: boolean;
  /** Its paired stretches, filled by {@link pairEmphasis}. */
  edges: EmphasisEdge[];
}

/** One paired stretch of a run's characters: delimiter syntax that opens or closes marks. */
interface EmphasisEdge {
  start: number;
  end: number;
  open: boolean;
  marks: readonly Mark[];
}

/**
 * The run of `char` starting at `i` in `[from, to)`, with its flanking.
 *
 * Flanking is CommonMark's, minus its punctuation clause, so it mirrors
 * `matchInlineFormat`'s whitespace rules: a run may OPEN when the character
 * after it is not whitespace, and CLOSE when the character before it is not —
 * so `2 * 3 * 4` and `**a **` stay literal. A range edge counts as whitespace.
 * The `_` family (`intraword: false`) further needs punctuation or space on the
 * outside, so `snake_case_name` stays literal.
 */
function delimRunAt(
  s: Scan,
  i: number,
  from: number,
  to: number,
  char: string,
  line: number,
): DelimRun {
  let j = i;
  while (j < to && isDelimCharAt(s, j, char)) j += 1;
  const before = i > from ? s.text[i - 1] : undefined;
  const after = j < to ? s.text[j] : undefined;
  const leftFlanking = after !== undefined && !WHITESPACE.test(after);
  const rightFlanking = before !== undefined && !WHITESPACE.test(before);
  const intraword = EMPHASIS_ROWS.get(char)![0]!.intraword;
  const outside = (c: string | undefined): boolean =>
    c === undefined || PUNCTUATION_OR_SPACE.test(c);
  return {
    char,
    start: i,
    length: j - i,
    lo: i,
    hi: j,
    canOpen: leftFlanking && (intraword || outside(before)),
    canClose: rightFlanking && (intraword || outside(after)),
    line,
    active: true,
    edges: [],
  };
}

/**
 * Pair the emphasis runs of one span — CommonMark's "process emphasis", over
 * our table. Each closer, left to right, looks back for the NEAREST opener of
 * its character on its line; a pair takes the longest row both still hold
 * (`***` + `***` is one bold+italic pair, `**` + `***` a bold pair leaving one
 * `*`), from the inside out — the opener's last characters and the closer's
 * first. Every run between the two is then dead (its characters literal), so
 * pairs always nest.
 *
 * This is what lets the serializer's output read back when delimiters touch:
 * `**a*b***` (italic closing where bold closes), `**a***b*` (bold, then italic),
 * `*a**b**c*` (bold inside italic). A rule that demands each delimiter be a
 * whole run of its character rejects every one of those.
 *
 * The RULE OF THREE: when either side could both open and close, the
 * characters the two runs have LEFT may not sum to a multiple of three unless
 * both counts are. It is what tells `*a**b**c*` (the inner `**` opens) from a
 * closer. CommonMark sums the runs' written lengths instead; counting what is
 * left is what reads `*x***y*…***` right, where one `***` first closes an
 * italic and then opens a bold — its written length would let a later
 * italic OPENER close that bold.
 */
function pairEmphasis(runs: DelimRun[]): void {
  for (let ci = 0; ci < runs.length; ci++) {
    const closer = runs[ci]!;
    if (!closer.canClose) continue;
    while (closer.active && closer.lo < closer.hi) {
      let found = -1;
      let row: InlineSyntax | undefined;
      for (let oi = ci - 1; oi >= 0; oi--) {
        const opener = runs[oi]!;
        if (opener.line !== closer.line) break;
        if (!opener.active || !opener.canOpen) continue;
        if (opener.char !== closer.char || opener.lo === opener.hi) continue;
        const openLeft = opener.hi - opener.lo;
        const closeLeft = closer.hi - closer.lo;
        if (
          (opener.canClose || closer.canOpen) &&
          (openLeft + closeLeft) % 3 === 0 &&
          !(openLeft % 3 === 0 && closeLeft % 3 === 0)
        ) {
          continue;
        }
        const room = Math.min(openLeft, closeLeft);
        row = EMPHASIS_ROWS.get(closer.char)!.find((r) => r.tag.length <= room);
        if (!row) continue;
        found = oi;
        break;
      }
      if (found === -1 || !row) break;
      const opener = runs[found]!;
      for (let k = found + 1; k < ci; k++) runs[k]!.active = false;
      const d = row.tag.length;
      opener.hi -= d;
      opener.edges.push({
        start: opener.hi,
        end: opener.hi + d,
        open: true,
        marks: row.marks,
      });
      closer.edges.push({
        start: closer.lo,
        end: closer.lo + d,
        open: false,
        marks: row.marks,
      });
      closer.lo += d;
    }
  }
}

/** One thing a span holds, found by the left-to-right pass of {@link scanSpan}. */
type SpanItem =
  | { kind: "char"; at: number }
  | { kind: "escape"; at: number }
  | { kind: "mask"; start: number; end: number }
  | {
      kind: "nested";
      start: number;
      contentStart: number;
      contentEnd: number;
      end: number;
      attrs: Partial<ScanAttrs>;
      literal: boolean;
    }
  | { kind: "run"; run: DelimRun };

/**
 * Scan `[from, to)` under `attrs`, pushing FLAT runs into `out`. `literal` is set
 * inside a code span: escapes and protected spans still resolve there (a
 * decorator token materializes regardless of the surrounding marks), but no
 * delimiter, link or tag does — CommonMark's code-span precedence.
 *
 * Two passes. The first walks left to right and finds what binds tightest —
 * protected spans, escapes, `<tag>`s, links, code spans — plus the emphasis
 * delimiter RUNS between them. The second pairs those runs
 * ({@link pairEmphasis}) and emits, turning marks on and off at each paired
 * delimiter; an unpaired delimiter character is literal text.
 */
function scanSpan(
  s: Scan,
  from: number,
  to: number,
  attrs: ScanAttrs,
  out: RichText,
  literal: boolean,
  trace?: InlineScanTrace,
): void {
  const items: SpanItem[] = [];
  const runs: DelimRun[] = [];
  let line = 0;
  let i = from;
  while (i < to) {
    if (s.masked[i] === MASK) {
      let j = i;
      while (j < to && s.masked[j] === MASK) j += 1;
      items.push({ kind: "mask", start: i, end: j });
      line += countNewlines(s, i, j);
      i = j;
      continue;
    }
    if (isEscapeAt(s, i, to)) {
      items.push({ kind: "escape", at: i });
      i += 2;
      continue;
    }
    if (!literal) {
      const c = s.text[i]!;
      if (c === "<") {
        const tag = matchTag(s, i, to);
        if (tag) {
          items.push({
            kind: "nested",
            start: i,
            contentStart: tag.contentStart,
            contentEnd: tag.contentEnd,
            end: tag.end,
            attrs: tag.attrs,
            literal: false,
          });
          line += countNewlines(s, i, tag.end);
          i = tag.end;
          continue;
        }
      }
      if (c === "[") {
        const link = matchLink(s, i, to);
        if (link) {
          items.push({
            kind: "nested",
            start: i,
            contentStart: link.textStart,
            contentEnd: link.textEnd,
            end: link.end,
            attrs: { link: link.url },
            literal: false,
          });
          i = link.end;
          continue;
        }
      }
      const code = matchCodeSpan(s, i, to);
      if (code) {
        items.push({
          kind: "nested",
          start: i,
          contentStart: code.contentStart,
          contentEnd: code.contentEnd,
          end: code.end,
          attrs: { marks: [...CODE_SYNTAX.marks] },
          literal: true,
        });
        i = code.end;
        continue;
      }
      if (EMPHASIS_ROWS.has(c)) {
        const run = delimRunAt(s, i, from, to, c, line);
        runs.push(run);
        items.push({ kind: "run", run });
        i += run.length;
        continue;
      }
      if (c === "\n") line += 1;
    }
    items.push({ kind: "char", at: i });
    i += 1;
  }

  pairEmphasis(runs);

  const active = new Map<Mark, number>();
  const current = (): ScanAttrs => {
    const marks = [...attrs.marks];
    for (const [mark, n] of active) if (n > 0) marks.push(mark);
    return { ...attrs, marks: sortMarks(marks) };
  };
  let buf = "";
  // The source index of each character in `buf`, kept only when tracing.
  let bufSource: number[] = [];
  const flush = (): void => {
    if (buf.length > 0) {
      out.push(runWith(buf, current()));
      if (trace) trace.sourceOf.push(...bufSource);
      buf = "";
      bufSource = [];
    }
  };
  const syntax = (start: number, end: number): void => {
    if (trace && end > start) trace.syntax.push([start, end]);
  };
  const literalChar = (at: number): void => {
    buf += s.text[at]!;
    if (trace) bufSource.push(at);
  };

  for (const item of items) {
    switch (item.kind) {
      case "char":
        literalChar(item.at);
        break;
      case "escape":
        buf += escapedCharAt(s, item.at);
        if (trace) bufSource.push(item.at + 1);
        syntax(item.at, item.at + 1);
        break;
      case "mask": {
        flush();
        // A decorator token is never marked or coloured, but does inherit an
        // enclosing link — byte-for-byte `runs-lexical.ts`'s `walkNode`.
        out.push(
          attrs.link
            ? { text: s.text.slice(item.start, item.end), link: attrs.link }
            : { text: s.text.slice(item.start, item.end) },
        );
        if (trace)
          for (let k = item.start; k < item.end; k++) trace.sourceOf.push(k);
        break;
      }
      case "nested": {
        flush();
        syntax(item.start, item.contentStart);
        const base = current();
        scanSpan(
          s,
          item.contentStart,
          item.contentEnd,
          {
            ...base,
            ...item.attrs,
            marks: sortMarks([...base.marks, ...(item.attrs.marks ?? [])]),
          },
          out,
          item.literal,
          trace,
        );
        syntax(item.contentEnd, item.end);
        break;
      }
      case "run": {
        const { run } = item;
        const edges = [...run.edges].sort((a, b) => a.start - b.start);
        let k = run.start;
        for (const edge of edges) {
          while (k < edge.start) literalChar(k++);
          flush();
          syntax(edge.start, edge.end);
          for (const mark of edge.marks)
            active.set(mark, (active.get(mark) ?? 0) + (edge.open ? 1 : -1));
          k = edge.end;
        }
        while (k < run.start + run.length) literalChar(k++);
        break;
      }
    }
  }
  flush();
}

/** Real newlines in `[from, to)` — escaped breaks are not newlines by then. */
function countNewlines(s: Scan, from: number, to: number): number {
  let n = 0;
  for (let k = from; k < to; k++) if (s.text[k] === "\n") n += 1;
  return n;
}

/**
 * The scan over `text`: the text itself, its protected spans masked, and which
 * characters an escape spells (so `\*` is never a delimiter, whatever it sits
 * next to). Escapes pair left to right, as the scan reads them: `\\*` is an
 * escaped backslash, then a live `*`.
 *
 * Protected spans are masked over the WHOLE string here, but the serializer
 * found them run by run and escaped every other `\` and `[` — the characters
 * a protect family's token opens with. So a match may not start at an escaped
 * character: `\\(` is a literal backslash, then `(`, never the `\(` of a
 * LaTeX token that some later `\)` (another run's, or a link href's escaped
 * `)`) would close. The escapes this decides are read on the raw text first,
 * since a token's own bytes are taken verbatim and the final pass skips them.
 */
function scanOf(text: string, protectedSpans: RegExp[]): Scan {
  const masked = maskProtected(
    text,
    protectedSpans,
    escapeSpelled({ text, masked: text, escaped: new Uint8Array(0) }),
  );
  const s: Scan = { text, masked, escaped: new Uint8Array(0) };
  s.escaped = escapeSpelled(s);
  return s;
}

/** 1 at every character an escape spells, escapes paired left to right. */
function escapeSpelled(s: Scan): Uint8Array {
  const spelled = new Uint8Array(s.text.length);
  for (let i = 0; i < s.text.length; i++) {
    if (isEscapeAt(s, i, s.text.length)) {
      spelled[i + 1] = 1;
      i += 1;
    }
  }
  return spelled;
}

/** What a traced scan records beside its runs — see {@link InlineScan}. */
interface InlineScanTrace {
  syntax: [start: number, end: number][];
  sourceOf: number[];
}

/**
 * {@link parseInlineMarkdown}'s answer, with WHERE in the source each part of
 * it came from — for an editor showing the markdown itself (its syntax dimmed,
 * its marks drawn on their own text) and for one that edits it by marks.
 *
 * Read off the very scan the parse runs (a traced `scanSpan`), so a surface
 * drawing the source can never disagree with what the parse makes of it.
 */
export interface InlineScan {
  /** The runs — exactly `parseInlineMarkdown(text, protectedSpans)`. */
  runs: RichText;
  /**
   * Source ranges `[start, end)` that are syntax, not text: delimiters, the
   * `<u>` / `<color …>` tags and their closers, a link's `[` and `](url)`, an
   * escape's backslash. In source order, never overlapping.
   */
  syntax: [start: number, end: number][];
  /**
   * For each character of the runs' text (concatenated, in order), the index of
   * the source character it reads — so `sourceOf.length` is the runs' length,
   * and an escape's character maps to the escaped character, not the backslash.
   */
  sourceOf: number[];
}

/** {@link parseInlineMarkdown}, traced — see {@link InlineScan}. */
export function scanInlineMarkdown(
  text: string,
  protectedSpans: RegExp[],
): InlineScan {
  const s = scanOf(text, protectedSpans);
  const out: RichText = [];
  const trace: InlineScanTrace = { syntax: [], sourceOf: [] };
  scanSpan(s, 0, text.length, { marks: [] }, out, false, trace);
  trace.syntax.sort((a, b) => a[0] - b[0]);
  return {
    runs: coalesce(out),
    syntax: trace.syntax,
    sourceOf: trace.sourceOf,
  };
}

/**
 * Parse inline markdown into canonical `RichText`. Lenient by design (foreign
 * markdown pastes as well as it can; an unmatched delimiter, tag or bracket is
 * literal text), and canonical on output — `coalesce`d, marks `sortMarks`ed, no
 * zero-length runs. See the section header for the round-trip statement and the
 * escaping rule.
 */
export function parseInlineMarkdown(
  text: string,
  protectedSpans: RegExp[],
): RichText {
  const s = scanOf(text, protectedSpans);
  const out: RichText = [];
  scanSpan(s, 0, text.length, { marks: [] }, out, false);
  return coalesce(out);
}
