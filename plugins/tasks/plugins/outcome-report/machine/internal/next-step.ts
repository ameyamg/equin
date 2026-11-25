import { getConfig } from "@plugins/config_v2/server";
import {
  exitWhenPrompt,
  pushExitPromptsConfig,
  type ExitWhen,
  type PushExitPrompts,
} from "@plugins/conversations/plugins/conversation-view/plugins/push-and-exit/plugins/capabilities/core";

/**
 * What the agent is told once its report is saved: its mandate's exit rule
 * (`exit.clean`), word for word — the prompt its `## Mandate` section carries
 * for a non-default rule (`on-request` adds no Mandate line), so the tool can
 * never contradict it. A pending `question` waits for
 * its answer whatever the rule; no exit grant leaves the conversation open.
 * `prompts` is the push-and-exit prompts config as saved (a test passes its
 * defaults).
 */
export function nextStepAfterReport(
  exitWhen: ExitWhen | null,
  asked: boolean,
  prompts: PushExitPrompts = getConfig(pushExitPromptsConfig),
): string {
  if (asked)
    return "Report saved. End your turn: your question waits for the user's answer, which arrives as your next message.";
  if (exitWhen === null)
    return "Report saved. End your turn; do not close the conversation.";
  return `Report saved. ${exitWhenPrompt(prompts, exitWhen)}`;
}
