# Mail compose: one text format, shared with Pages

Task: task-1795746607-zpps77 (Mail rebuild, decision D14). Mock: prototype
proto-1795656296-rtsmk5.

The user asked how Pages stores text and whether Mail can use the same format.
They don't need strict markdown, and custom tags are fine. Already decided: the
body is plain text written in a markdown-like syntax, in ONE field with a
Markdown | Rich switch, both editable, with the Pages selection toolbar in both
modes.

## 1. How Pages stores text

- **Structure.** A page is a forest of `page_blocks` rows (`page/block-entity`):
  one row per block (paragraph, heading, list item, quote, code, …), linked by
  `parent_id` and a rank. A list or a quote holds its lines as child rows.
- **Text.** A text block's `data.text` is `RichText`: an array of runs
  `{ text, marks?, color?, link? }` (`page/editor/core/rich-text.ts`).
  - `marks` is a closed set: `bold`, `italic`, `underline`, `strikethrough`,
    `code`.
  - `color` is a closed set of theme tokens: `gray`, `brown`, `orange`,
    `yellow`, `green`, `blue`, `purple`, `pink`, `red`. There is no hex. They are
    painted through `--rt-color-*` (`colorCssValue`).
  - Inline chips are plain substrings of a run's text, the "protected spans":
    `[[page:<id>]]`, `[[date:<iso>]]`, `[[reminder:<id>:<iso>]]`, `\(latex\)`.
- **Live editing.** Each text block also has a Yjs doc
  (`page_block_docs`, `page/editor-collab`). The server stores those bytes
  without reading them. `data.text` is the runs projection of that doc.
- **The markdown dialect.** `read_page`, `edit_page` / `markdown-apply` and the
  clipboard all go through one pure pair in `page/editor/core`:
  `serializeForestToMarkdown` / `parseMarkdownToForest` for blocks, and
  `serializeInlineMarkdown` / `parseInlineMarkdown` for runs. Both take a
  `MarkdownContext`: the block handles, the protected spans and three dialect
  switches (`blankLines`, `emptyBlocks`, `softBreaks`).
  - **Inline:** `**bold**`, `_italic_`, `~~strike~~`, `` `code` ``,
    `[text](url)`. Markdown has no syntax for two of the marks, so they are tags:
    **`<u>…</u>`** for underline and **`<color value="red">…</color>`** for
    colour. Every literal `\ * _ ~ ` [ ] <` is backslash-escaped. A soft break is
    `\n` (escaped dialect) or a real newline (human dialect).
  - **Blocks:** one line per block, children indented by two spaces.
    `# ` / `## ` / `### ` headings, `* ` bullets (`- ` and `+ ` also parse),
    `1. ` numbered items, `- [ ] ` to-dos, fenced code, `---` dividers. Blocks
    markdown can't spell are XML-ish tags: `<quote>` … `</quote>` holds its
    children, and there are also `<callout>`, `<page …/>` and `<text/>` (an
    empty paragraph a blank line can't place). Note that `> ` is the **toggle**
    block, not a quote.
  - Each block type declares its own markdown (`markdownPrefixes` or a
    `markdown` declaration on its `defineBlock` handle). The orchestrator never
    names a block type, so a dialect is just a set of handles.

## 2. The proposed format: Pages' dialect over a Mail handle set

**A Mail body is the text `serializeForestToMarkdown` writes**, with a Mail
`MarkdownContext`:

- `handles`: text, heading-1/2/3, bulleted-list, numbered-list, quote,
  code-block, divider. No toggle, to-do, callout, sub-page, table, embeds,
  images or math. They don't belong in an email, and Mail would have to render
  each one as HTML.
- `protectedSpans: []` for now. No page links or dates in mail. Adding them
  later is a contribution, not a format change.
- `blankLines: "empty-block"`, because the text is read back by us: a blank
  line is an empty paragraph, the way an email spaces its paragraphs.
- `emptyBlocks: "blank-line"`, so the Markdown mode never shows `<text/>`. Its
  cost is that leading or trailing blank lines are dropped, which is right for
  an email body.
- `softBreaks: "newline"`. A line is a block. Shift+Enter is not needed: in
  email, a new line is a new paragraph.

So the body Mail stores (`DraftContent.body`, still a string) looks like this:

```
Hi Maya,

Agreed on moving the marketplace to **Q2**. Before Tuesday, could you:
* name an owner for [plugin signing](https://docs.example.com/plugin-signing)
* say _plainly_ what slips, and <u>why</u>
* move the `marketplace` milestone — <color value="red">it's late</color>

<quote>
  Can we ship before the freeze?
</quote>
```

The same marks and colours as Pages, written the same way. One parser and one
serializer serve both apps, and so does the toolbar (bold, italic, underline,
strikethrough, code, link, colour).

Why a string and not a forest: a draft is one value, saved whole (`saveMailDraft`)
and sent whole, with no per-block identity to keep. Pages needs block rows for
backlinks, sub-pages and collaboration, and a draft has none of those. The
string is the forest's canonical spelling, so nothing is lost.

**Quoted original and signature stay outside the body**, as they already are
(`r.quote`, `content.signature`). The editor shows them below the field, in
the mode's look. The quoted original is in the same dialect, as one `<quote>`
(the mock lets it be edited; whether the build stores an edited quote is for its
own task). In the text/plain part it becomes `> ` lines. A quote the user writes
in the body is also `<quote>`. In Rich mode it is typed with Pages' own `| `
prefix, because `> ` is Pages' toggle.

## 3. What's reused, what's missing

**Reused as-is** (`page/editor/core`, pure, both runtimes):

- `RichText` / `TextRun` / `Mark` / `ColorToken`, `coalesce`, `sortMarks`.
- `parseMarkdownToForest` / `serializeForestToMarkdown` and the inline pair,
  including escaping, whitespace hoisting and the round-trip guarantee.
- The block handles of the types listed above (their core `defineBlock`
  handles).
- `INLINE_SYNTAXES` / `matchInlineFormat` for typing-time autoformat in Rich
  mode, and the format toolbar and shortcuts (`FormatToolbarPlugin`,
  `FormatShortcutsPlugin`) that `RichTextField` already mounts.

**Missing** (to build):

1. **A multi-block single-field Lexical editor over a forest.** It is Rich mode.
   `RichTextField` edits ONE block's runs (table cells). The page editor edits
   many blocks, but each is its own Lexical instance over a Yjs doc and a
   `page_blocks` row. Mail needs one Lexical instance whose root holds
   paragraphs, headings, lists and a quote, read and written as the forest
   (runs ⇄ Lexical exists per block in `runs-lexical.ts`; the block-level walk
   around it is new). It belongs in `page/editor` (or a `text-editor` primitive)
   as a reusable "document field", not in Mail.
2. **Markdown mode.** A plain-text field over the source with the syntax dimmed,
   driven by `parseInlineMarkdown`'s own scan so it can never disagree with
   Rich mode. The toolbar there wraps the selection in the dialect's spelling
   (`**`, `<u>`, `<color value>`, …): serialize the toggled runs, splice the
   line.
3. **HTML for recipients: `forestToEmailHtml`.** A small server-side walk in
   `mail/compose/core`: `<p>`, `<h1-3>`, `<ul>/<ol>`, `<blockquote>`, `<pre>`,
   `<hr>`; marks as `<b> <i> <u> <s> <code> <a>`; colour as an inline
   `style="color:#…"` from a **fixed light-on-white palette** per `ColorToken`.
   Email can't use CSS variables, and the recipient's client chooses the
   background. Pages has no forest→HTML string (read-only-view renders React
   with theme classes), so this is new. It should go beside the dialect so a
   Pages "send as email" can reuse it later.
4. **The plain-text alternative** (`text/plain` part): the same forest walk
   rendered for a person in a plain mail client. Markdown marks stay
   (`**`, `_`, `` ` ``, `[x](url)`), because they read naturally. Underline
   and colour tags are dropped, keeping their text. `<quote>` becomes `> `
   lines (the email convention). Bullets are `* ` and items `1. `. The
   signature and quoted original are added as today (`messageText`). That is
   `serializeInlineMarkdown` with an inline "human" switch, which is missing:
   a `tags: "keep" | "drop"` on the context, or a run pre-pass that strips
   underline and colour before serializing. The pre-pass is simplest and keeps
   the core untouched.
5. **`buildMimeMessage`** gets an `html` part next to `text`
   (`multipart/alternative`). It already takes `html`; the outbox passes only
   `text` today.

**Open question for Pages, not blocking Mail:** in Pages, `> ` is the toggle
and a quote is `<quote>`. If Pages ever moves quote to `> ` (the markdown
meaning), Mail follows for free, because the handles own the spelling.
