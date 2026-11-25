import { SystemPrompt } from "@plugins/conversations/plugins/system-prompt/server";
import type { PromptText } from "@plugins/config_v2/plugins/prompts/core";
import { renderConfigPrompt } from "@plugins/config_v2/plugins/prompts/server";
import { getConversation } from "@plugins/tasks/plugins/tasks-core/server";
import { sourcePagePromptsConfig } from "../../core";
import { tasksSourceUrl } from "./tables";

/**
 * The page the agent's task was filed from, as context rather than as part of
 * the user's words: the draft form's Page URL toggle stores it as data
 * (`tasks_ext_source_url`), and this section hands it to the agent at every
 * spawn, in the user's words (`sourcePagePromptsConfig`). Nothing when the
 * conversation has no task or its task no stored url.
 */
export async function renderSourcePage(
  conversationId: string,
): Promise<PromptText | null> {
  const conversation = await getConversation(conversationId);
  if (conversation === null) return null;
  const row = await tasksSourceUrl.get(conversation.taskId);
  if (row === undefined) return null;
  return renderConfigPrompt(sourcePagePromptsConfig, "sourcePage", {
    url: row.url,
  });
}

export const sourcePageSection = SystemPrompt.Section({
  id: "source-page",
  label: "Source page",
  heading: "Source page",
  followsMandate: false,
  render: (conversationId) => renderSourcePage(conversationId),
});
