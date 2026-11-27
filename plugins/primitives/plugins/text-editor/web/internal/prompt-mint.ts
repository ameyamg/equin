import type { PromptMarkdown } from "../../core";

/**
 * The editor's mint: what it serializes is the prompt field's markdown — the
 * one producer of `PromptMarkdown` (see its doc in `core`). Never exported
 * from the barrel.
 */
export function editorMarkdown(markdown: string): PromptMarkdown {
  return markdown as PromptMarkdown;
}
