import { defineServerContribution } from "@plugins/framework/plugins/server-core/core";
import type { PromptText } from "@plugins/config_v2/plugins/prompts/core";

/**
 * One plugin's part of what equin appends to an agent's system prompt — the
 * channel for context about THIS agent and its task (its mandate, the global
 * page instructions, its task tree), as opposed to how to use a tool (the
 * tool's own description).
 *
 * **Instructions are config, not code.** A section's words are prompt fields
 * (`config_v2/prompts`' `promptField`) the user sees and edits in Settings →
 * Config: `render` returns a `PromptText`, which only rendering such a field
 * makes, so a sentence written here does not type-check. Code decides only
 * whether the section applies (`null`) and the data the prompts are filled
 * with. A generated listing that is data, never instructions (the task tree's
 * lines), is a `listing` instead.
 *
 * It runs at every spawn of the agent's process — its launch and every
 * resume — right before the process starts, so what it returns is what that
 * process runs with until it stops. A change while it runs reaches it as an
 * event turn, from the plugin that owns the change — a section that depends
 * on the agent's mandate says so (`followsMandate`), and the mandate change
 * notice re-sends it. `null` (or blank) adds nothing. Sections join in id
 * order, each `## {heading}` then its body, wrapped in `<equin-context id>`.
 *
 * Nothing caps the system prompt the way MCP server instructions are capped
 * (4,096 characters, cut silently), but every character is paid on every turn:
 * write only what no tool description, gate or CLAUDE.md already says. The
 * context card shows each section's share.
 */
export type SystemPromptSection = SystemPromptSectionBase &
  (
    | {
        /** The section's body: prompt fields, filled — never a literal. */
        render(conversationId: string): Promise<PromptText | null>;
        listing?: never;
      }
    | {
        /**
         * The section's body when it is a generated listing — data the
         * agent reads (ids, titles, statuses), never an instruction. Any
         * sentence telling the agent what to do belongs in a prompt field and
         * a `render`.
         */
        listing(conversationId: string): Promise<string | null>;
        render?: never;
      }
  );

interface SystemPromptSectionBase {
  /** Stable id: the wrapper's `id`, the record's key, the order. */
  id: string;
  /** What the context card calls it ("Mandate", "Task tree"). */
  label: string;
  /** The section's title, written `## {heading}` above its body. A title,
   * never an instruction. */
  heading: string;
  /**
   * Whether what `render` returns depends on the conversation's mandate (its
   * grants, its kind, where it is stated). Such a section is rendered again
   * when the mandate changes under a running agent and sent to it in the
   * change notice, since its system prompt is fixed for the life of its
   * process. Required, so every section decides.
   */
  followsMandate: boolean;
}

export const SystemPrompt = {
  Section: defineServerContribution<SystemPromptSection>(
    "conversations.system-prompt.section",
    { docLabel: (s) => s.id },
  ),
};
