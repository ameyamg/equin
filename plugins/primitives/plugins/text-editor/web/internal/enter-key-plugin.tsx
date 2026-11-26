import { useEffect } from "react";
import { COMMAND_PRIORITY_HIGH, KEY_ENTER_COMMAND } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

/**
 * ⌘/Ctrl+Enter is never a newline. With an `onSubmit` it submits, in every
 * submit mode, so the same muscle memory works in every composer; `"enter"`
 * additionally submits on a bare Enter (Shift / Alt+Enter still insert a
 * newline there). Without one (`onSubmit` absent, or `submitMode: "none"`)
 * the key is left to the page: the editor does not take it, so a surface
 * shortcut on ⌘↵ (a Submit bar sending what the field drafts) fires from
 * inside the field instead of a line being inserted.
 */
export function EnterKeyPlugin({
  onSubmit,
  submitMode,
}: {
  onSubmit: (() => void) | null;
  submitMode: "enter" | "cmd-enter" | "none";
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand<KeyboardEvent | null>(
      KEY_ENTER_COMMAND,
      (event) => {
        if (!event) return false;
        if (event.isComposing) return false;
        const modSubmit = event.metaKey || event.ctrlKey;
        if (onSubmit === null || submitMode === "none")
          // Handled (no paragraph) but not prevented: it reaches the page.
          return modSubmit;
        const bareSubmit =
          submitMode === "enter" && !event.shiftKey && !event.altKey;
        if (!modSubmit && !bareSubmit) return false;
        event.preventDefault();
        onSubmit();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onSubmit, submitMode]);

  return null;
}
