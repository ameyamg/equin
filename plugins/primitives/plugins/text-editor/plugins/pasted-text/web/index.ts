import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { InlineTextWalkerSlot } from "@plugins/primitives/plugins/inline-text/web";
import { TextEditorSlots } from "@plugins/primitives/plugins/text-editor/web";
import { PastedTextPastePlugin } from "./internal/paste-plugin";
import { PastedTextWalker } from "./internal/walker";
import "./internal/register";

export { PastedTextBlock } from "./components/pasted-text-block";
export type { PastedTextEditing } from "./components/pasted-text-block";

export default {
  description:
    "A large paste (10+ lines or 1000+ characters) in any text editor becomes a pasted block: a folded box with a 'Pasted log / code / JSON / text' header and its line count, unfolding on click to its editable text, with Copy, Delete and Expand-to-plain-text on hover. It is sent as a <pasted_content> tag (so the agent knows the text was pasted) and drawn back as the same block, read-only, in sent messages.",
  contributions: [
    TextEditorSlots.Plugin({
      id: "pasted-text",
      component: PastedTextPastePlugin,
    }),
    // First, on the raw string: a pasted body is opaque to every later
    // walker, so a pasted agent reply keeps its `<go>` and chip text as text.
    InlineTextWalkerSlot({
      id: "pasted-text",
      stage: -2,
      Component: PastedTextWalker,
    }),
  ],
} satisfies PluginDefinition;
