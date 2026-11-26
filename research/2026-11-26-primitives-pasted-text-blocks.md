# Pasted text blocks

## Context

Pasting a big blob (a log, a file, a stack trace) into an agent composer floods
the draft and the sent message. Agreed design (prototype
`proto-1795704843-weeth6`): a large paste becomes a **folded block** in the
composer — header `› <icon> Pasted log · N lines`, three faded preview lines, no
divider under the header. Clicking unfolds it; the text inside is editable. On
hover: **Copy**, **Delete**, **Expand** (back to plain text in place). The sent
message shows the same block, read-only (Copy only). The agent is told the text
was pasted.

## Wire format

```
<pasted_content>
…body…
</pasted_content>
```

- Plain tag, **no id**. Claude Code's own grammar (`<pasted_content id="e112">` …
  `</pasted_content id="e112">`) is unwrapped by `transcript-source`'s
  `unwrapPastedContent` on every transcript read. Using it would make the
  transcript's text differ from what we sent (pending-turn "Not confirmed" +
  duplicate on Retry) and would drop the block from the rendered message. The id-less
  form is left alone by that parser by construction ("anything that does not
  match exactly is left alone").
- The tag name alone tells the model the content is pasted material.
- Kind (log / code / json / text) and line count are derived from the body, not stored.

## Threshold

Large = ≥ 10 lines or ≥ 1000 chars (one huge line, e.g. minified JSON, counts).
Below that a paste stays plain text. Expand covers a wrong guess.

## Changes

1. **token-extension: tokens that span lines** (`primitives/text-editor/token-extension`).
   Today the editor deserializes line by line, so a multi-line token cannot exist.
   - `tokenExtension({ …, spansLines?: true })` / `InlineTokenExtension.spansLines`.
   - `node/core/insert-tokens.ts`: `$tokenizedTextLines(text, extensions)` —
     spanning families scanned over the whole text first, everything else per
     line, as before. Opt-in, so no existing pattern changes behaviour.
     `$insertTokenizedText` uses it.
   - `text-editor/web/internal/markdown.ts` `applyMarkdownToEditor` uses it. The serializer and
     caret mapping already measure nodes by serialized length, so a multi-line
     token round-trips unchanged.
   - `registerNodeExtension` passes `spansLines` through.
2. **New plugin `primitives/text-editor/pasted-text`**
   - `core/`: `PASTED_TEXT_RE`, `wrapPastedText`, `isLargePaste`,
     `pastedTextKind`, `splitPastedText` (read surfaces), and the node family
     `pastedTextNode` (`defineInlineTokenNode`, field `body`,
     `textContent: "token"` so copy keeps it).
   - `web/`:
     - The decorated node draws `<PastedTextBlock editable>`. When unfolded, the body is a `<textarea>`
       whose edits `setFields` the node. Native listeners call Lexical's
       `stopLexicalPropagation` so Enter, paste and typing stay in the textarea.
     - `PastedTextPastePlugin` (`TextEditorSlots.Plugin`, PASTE at NORMAL) declines when there are files, a Lexical
       clipboard or an embedded-input target. Otherwise a large paste becomes the node at the caret.
     - An `InlineTextWalkerSlot` walker (stage −0.5, after `go`, before the
       active-data chips) draws `<PastedTextBlock>` read-only in sent messages,
       the pending echo and task descriptions. The body is opaque to later walkers.
3. Both composers (conversation `PromptEditor`, task-draft `ComposerField`) share
   `TextEditor`, so both get it with no call-site change.

## Verification

- Unit: `pasted-text/core` (wrap/split/threshold/kind), `$tokenizedTextLines`
  + markdown round-trip with a spanning token (jsdom, headless editor).
- Build, then in the app's conversation composer: paste a 60-line log, and check that it becomes a block,
  unfolds, edits, Copy, Delete and Expand all work, and Enter inside the textarea does not send. Send it, and check that the transcript
  shows the read-only block, the agent receives the tag, and the turn is confirmed (not
  "Not confirmed").
