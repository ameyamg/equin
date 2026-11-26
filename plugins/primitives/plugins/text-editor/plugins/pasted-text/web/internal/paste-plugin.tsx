import { useEffect } from "react";
import {
  $getSelection,
  $isEventFromEmbeddedInput,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  PASTE_COMMAND,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { clipboardEventOf } from "@plugins/primitives/plugins/text-editor/plugins/clipboard-event/core";
import { isLargePaste } from "../../core";
import { $createPastedTextNode } from "./pasted-text-node";

/** Lexical's own clipboard flavor: a copy out of an editor, nodes already built. */
const LEXICAL_MIME = "application/x-lexical-editor";

/**
 * A large text paste becomes a pasted block at the caret instead of a wall of
 * text in the draft. It declines — leaving the paste to the next handler — for:
 *
 * - files (the attachment upload owns those, at the same priority),
 * - a copy out of an editor (its nodes, a block included, are rebuilt as they were),
 * - a paste inside an embedded input (a block's own textarea),
 * - text below the size bounds (`isLargePaste`).
 */
export function PastedTextPastePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if ($isEventFromEmbeddedInput(event)) return false;
          const data = clipboardEventOf(event)?.clipboardData ?? null;
          if (!data || data.files.length > 0) return false;
          if (Array.from(data.types).includes(LEXICAL_MIME)) return false;
          const text = data.getData("text/plain").replace(/\r\n?/g, "\n");
          if (!isLargePaste(text)) return false;
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          event.preventDefault();
          selection.insertNodes([$createPastedTextNode(text)]);
          return true;
        },
        COMMAND_PRIORITY_NORMAL,
      ),
    [editor],
  );
  return null;
}
