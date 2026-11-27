import {
  PromptMarkdownSchema,
  type PromptMarkdown,
} from "@plugins/primitives/plugins/text-editor/core";
import { defineStore } from "@plugins/primitives/plugins/dom/plugins/web-storage/web";
import {
  DEFAULT_DRAFT_TTL,
  legacyDraftKeys,
} from "@plugins/primitives/plugins/kept-state/web";

/**
 * The store of a conversation's unsent prompt, scoped by conversation id. One
 * definition: every surface that puts text back into the prompt editor (Copy
 * to draft, rewind, the composers, Push & Exit) reads and writes this store.
 * It lives here, not in prompt-input, because prompt-input imports this plugin.
 */
export const conversationPromptDraft = defineStore<PromptMarkdown>({
  owner: "conversations.prompt-draft",
  label: "Prompt drafts",
  area: "local",
  cap: "1 MB",
  ttl: DEFAULT_DRAFT_TTL,
  whenFull: "refuse",
  // The prompt editor's markdown: a draft read back is still a prompt.
  schema: PromptMarkdownSchema,
  legacy: legacyDraftKeys("conversation:prompt"),
});
