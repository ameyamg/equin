import {
  getAttempt,
  getConversation,
} from "@plugins/tasks/plugins/tasks-core/server";

/** The task a conversation of this instance works on, or null when it holds no such conversation. */
export async function taskOfConversation(
  conversationId: string,
): Promise<string | null> {
  const conversation = await getConversation(conversationId);
  if (conversation === null) return null;
  const attempt = await getAttempt(conversation.attemptId);
  return attempt?.taskId ?? null;
}
