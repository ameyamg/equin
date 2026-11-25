import { z } from "zod";
import { Mcp } from "@plugins/infra/plugins/mcp/server";
import {
  assertChoiceLaunchable,
  ModelChoiceSchema,
} from "@plugins/conversations/plugins/model-provider/core";
import { getModelCatalog } from "@plugins/conversations/plugins/model-provider/plugins/catalog/server";
import { requestCleanExit } from "@plugins/conversations/plugins/conversation-view/plugins/push-and-exit/server";
import { getConversation } from "@plugins/tasks/plugins/tasks-core/server";
import { supervisorRole } from "@plugins/tasks/plugins/supervisor-roles/core";
import { granted } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { roleOfConversation } from "@plugins/tasks/plugins/supervisor-roles/server";
import { recordHandoff } from "@plugins/tasks/plugins/supervisor-roles/plugins/sessions/server";

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

export const handoffTool = Mcp.tool({
  name: "handoff",
  when: granted(supervisorRole),
  description: `Hand your role over to a fresh session and close this one — like \`exit_clean\`, but the role carries on. Use it when this conversation has grown long (its context is full of finished work) and the role still has work to watch.

Once this turn ends, this conversation closes and a new session of your role launches: it starts with the role's own prompt, as every session does, and your \`handoff\` text as context after it. Every open task of your session's tree (not done or dropped) moves under the new session's root, so it watches them from its first turn.

Write \`handoff\` for a reader who knows the role but none of this conversation: what is in flight and why, what you are waiting on, decisions taken and their reasons, what to do next. Never restate the role's prompt.

Refused — nothing changes, the conversation stays open — while something must be settled before an exit (as for \`exit_clean\`); the refusal says what to do, then call it again.`,
  inputSchema: {
    handoff: z
      .string()
      .trim()
      .min(1)
      .describe("What the next session needs to know, as markdown."),
    model: ModelChoiceSchema.optional().describe(
      "The model the next session launches with; absent = the default.",
    ),
  },
  async handler(input, { conversationId }) {
    const role = await roleOfConversation(conversationId);
    if (role === null)
      throw new Error("This conversation is not a supervisor role's session.");
    const conversation = await getConversation(conversationId);
    if (conversation?.taskId !== role.rootTaskId)
      throw new Error(
        `Only the session's root conversation (on ${role.rootTaskId}) hands the role off.`,
      );
    if (input.model !== undefined)
      assertChoiceLaunchable(input.model, getModelCatalog());
    const refusals = await requestCleanExit(conversationId, {
      beforeClose: () =>
        recordHandoff({
          fromTaskId: role.rootTaskId,
          roleId: role.roleId,
          handoff: input.handoff,
          model: input.model ?? null,
        }),
    });
    if (refusals.length > 0)
      return text(
        `Refused: settle this first, then call handoff again.\n\n${refusals.join("\n\n")}`,
      );
    return text(
      "Handed off: this conversation closes once this turn ends, and the next session of your role launches then with your handoff. End your turn now.",
    );
  },
});
