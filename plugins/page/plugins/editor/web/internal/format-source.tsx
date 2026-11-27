import { createContext, useContext } from "react";
import {
  $getEditor,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
} from "lexical";
import {
  $getSelectionStyleValueForProperty,
  $patchStyleText,
} from "@lexical/selection";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  colorCssValue,
  MARK_ORDER,
  type ColorToken,
  type Mark,
} from "../../core";

/** What the selection carries, as the format toolbar shows it. */
export interface FormatSnapshot {
  /** Whether each mark covers the whole selection. */
  active: Record<Mark, boolean>;
  /** The href the selection sits within, or `null`. */
  link: string | null;
  /**
   * The colour applied uniformly across the selection, or `null` when it has
   * none or mixes several. `"default"` is never reported.
   */
  color: ColorToken | null;
}

/**
 * WHERE formatting lives in the editor the toolbar and shortcuts act on — the
 * one seam between the format controls (the `Editor.FormatAction` buttons,
 * `FormatShortcutsPlugin`) and the text they format.
 *
 * A page block's text holds its marks as Lexical format bits, styles and link
 * nodes ({@link RICH_FORMAT_SOURCE}, the default). A document field's Markdown
 * mode holds them as the SOURCE's own spelling (`**`, `<u>`, `<color …>`), so
 * toggling bold there wraps the selection in delimiters. A control never
 * dispatches a Lexical format command itself: it asks the source, so one
 * toolbar serves both kinds of text.
 *
 * Every `$` method runs inside the editor's read (`$read`) or update (the
 * rest), against its current selection.
 */
export interface FormatSource {
  /** The selection's snapshot. Called for a non-collapsed range selection. */
  $read(): FormatSnapshot;
  /** Toggle `mark` over the selection: on unless it already covers all of it. */
  $toggleMark(mark: Mark): void;
  /** Colour the selection (`"default"` clears it). */
  $setColor(token: ColorToken): void;
  /** Link the selection to `href`, or unlink it (`null`). */
  $setLink(href: string | null): void;
  /**
   * Whether a collapsed caret shows the pending-marks cue. Only where marks are
   * typed WITH the caret (format bits) — in a source the marks are characters.
   */
  caretCue: boolean;
}

function selectionLink(): string | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  let cur: ReturnType<typeof selection.anchor.getNode> | null =
    selection.anchor.getNode();
  while (cur) {
    if ($isLinkNode(cur)) return cur.getURL();
    cur = cur.getParent();
  }
  return null;
}

function selectionColor(): ColorToken | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  // "" when the value is not uniform across the selection: no single colour.
  const value = $getSelectionStyleValueForProperty(selection, "color", "");
  const match = /var\(--rt-color-([a-z]+)\)/.exec(value);
  return match ? (match[1] as ColorToken) : null;
}

/** Marks as Lexical format bits, colour as a `--rt-color-*` style, links as `LinkNode`s. */
export const RICH_FORMAT_SOURCE: FormatSource = {
  $read() {
    const selection = $getSelection();
    const active = {} as Record<Mark, boolean>;
    for (const mark of MARK_ORDER)
      active[mark] = $isRangeSelection(selection) && selection.hasFormat(mark);
    return { active, link: selectionLink(), color: selectionColor() };
  },
  $toggleMark(mark) {
    // Through the command, so the RichText handler (and anything listening at
    // its priority) runs exactly as for Lexical's own shortcuts.
    $editorOfUpdate().dispatchCommand(FORMAT_TEXT_COMMAND, mark);
  },
  $setColor(token) {
    const selection = $getSelection();
    if ($isRangeSelection(selection))
      $patchStyleText(selection, { color: colorCssValue(token) });
  },
  $setLink(href) {
    $editorOfUpdate().dispatchCommand(TOGGLE_LINK_COMMAND, href);
  },
  caretCue: true,
};

// The editor the active update belongs to: a source method is always called
// inside one, and that is the editor it formats.
function $editorOfUpdate() {
  return $getEditor();
}

const FormatSourceContext = createContext<FormatSource>(RICH_FORMAT_SOURCE);

/**
 * Sets the format source for the editor composed inside it. Rendered inside
 * the `LexicalComposer`, around nothing but its plugins: the source belongs to
 * ONE editor.
 */
export const FormatSourceProvider = FormatSourceContext.Provider;

/** The format source of the surrounding editor (rich by default). */
export function useFormatSource(): FormatSource {
  // Read inside a composer only — the source has no meaning without its editor.
  useLexicalComposerContext();
  return useContext(FormatSourceContext);
}
