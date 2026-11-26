import { z } from "zod";
import { Mcp } from "@plugins/infra/plugins/mcp/server";
import {
  conversationMandate,
  granted,
} from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import {
  getConversation,
  getTask,
  setMandate,
} from "@plugins/tasks/plugins/tasks-core/server";
import { supervisorMandate } from "@plugins/tasks/plugins/mandate-presets/core";
import { recordNotification } from "@plugins/shell/plugins/notifications/server";
import { mandateEscalate } from "@plugins/tasks/plugins/supervisor-run/plugins/capability/core";

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

/**
 * The agent running an interactive task switches that task to the supervisor
 * mandate — what the task detail's Mandate select does, asked by the agent.
 * Everything after follows from the mandate change (mandate/change-notice):
 * the MCP server reconnects with the supervisor's tools, and the Mandate /
 * Supervisor / Task tree sections arrive as an event turn. The person is told
 * in the bell, with the agent's reason; switching back is theirs.
 */
export const becomeSupervisorTool = Mcp.tool({
  name: "become_supervisor",
  when: granted(mandateEscalate),
  description: `Switch your own task to supervisor mode, when its scope turns out too big to do well in one context: several large independent parts, or more work than fits before compactions start losing it.

As a supervisor you split the work into child tasks (\`add_task\`, start "now"), each run by its own agent that reports back to you, and you watch, review and integrate them instead of doing it all yourself. You keep this conversation; your new tools and instructions arrive as your next message. The user is notified, with your reason.

Do not use it for work you can finish yourself in this conversation.`,
  inputSchema: {
    reason: z
      .string()
      .min(1)
      .describe(
        "Why this task needs a supervisor — shown to the user: the parts you will split it into, and why one context is not enough.",
      ),
  },
  async handler({ reason }, { conversationId }) {
    const mandate = await conversationMandate(conversationId);
    if (mandate.kind === "none")
      throw new Error(`Conversation ${conversationId} runs no task.`);
    // The grant reaches a side chat only through its own stated mandate,
    // which never decides its task's.
    if (mandate.stated)
      return text(
        "Refused: this is a side chat opened beside the conversation running the task — only that conversation may switch the task's mandate.",
      );
    const conversation = await getConversation(conversationId);
    if (conversation === null)
      throw new Error(`No conversation "${conversationId}".`);
    const taskId = conversation.taskId;
    const task = await getTask(taskId);
    if (task === null) throw new Error(`No task "${taskId}".`);
    await setMandate(taskId, supervisorMandate);
    await recordNotification({
      type: "task-mandate",
      category: "conversations",
      title: "Switched itself to supervisor",
      description: reason,
      subjectId: taskId,
      subjectName: task.title,
      variant: "info",
    });
    return text(
      "Switched: your task now states the supervisor mandate. Your new tools and the Supervisor instructions arrive as your next message; read them, then plan the child tasks.",
    );
  },
});
