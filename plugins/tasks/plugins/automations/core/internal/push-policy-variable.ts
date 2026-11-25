import type { PromptVariable } from "@plugins/packages/plugins/prompt-template/core";

/**
 * The variable every automation's template may use: the paragraph saying what
 * the Push setting lets the agent do. A template without it never tells the
 * agent it may push, so it never does.
 */
export const PUSH_POLICY_VARIABLE: PromptVariable = {
  name: "pushPolicy",
  description: "What the Push setting allows, as an instruction",
};
