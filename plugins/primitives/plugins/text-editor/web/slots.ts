import { type ComponentType } from "react";
import { defineRenderSlot } from "@plugins/primitives/plugins/slot-render/web";
import type { InlineTokenExtension } from "@plugins/primitives/plugins/text-editor/plugins/token-extension/core";

export interface TextEditorPluginProps {
  onError?: (msg: string) => void;
  /**
   * The token families this editor materializes (read at render, so it
   * includes families that registered late) — what a plugin asks when it
   * needs the text as the editor will draw it.
   */
  extensions: readonly InlineTokenExtension[];
}

export const TextEditorSlots = {
  Plugin: defineRenderSlot<{
    component: ComponentType<TextEditorPluginProps>;
  }>(),
};
