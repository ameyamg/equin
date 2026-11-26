import { StopGate } from "@plugins/conversations/plugins/stop-gate/server";
import { getConversation } from "@plugins/tasks/plugins/tasks-core/server";
import { grantOf } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { reportRequired } from "@plugins/tasks/plugins/outcome-report/plugins/capability/core";
import { TURN_FOR_TOOL } from "./report-line";
import { turnForTool } from "./turn-for";
import { readRunState, userInRun } from "./run-state";

/**
 * Once the user has talked to an agent whose runs are handed back, each of
 * its turns either waits on the user (their reply or decision) or is handed
 * back to whoever started it — and only the agent knows which. So it may
 * not stop until it said (`turn_for`, after the user's latest word). A run nobody but its starter is in needs no call: its end is
 * handed back as is. No flaw: who a reply is meant for is the agent's call,
 * and no API can derive it.
 */
export const turnForStopGate = StopGate({
  id: "outcome-report.turn-for",
  tools: [turnForTool],
  async check(conversationId) {
    if ((await grantOf(reportRequired, conversationId)) === null)
      return { kind: "allow" };
    const conversation = await getConversation(conversationId);
    if (conversation === null) return { kind: "allow" };
    const state = await readRunState(conversation);
    if (!userInRun(state) || state.addressee !== null) return { kind: "allow" };
    return {
      kind: "block",
      reason: `The user has talked to you in this run, so before you stop call \`${TURN_FOR_TOOL}\` to say what happens next. \`supervisor\` when nothing is pending on the user (the work is done, or you are blocked on someone else), even if your message answers them: your last message becomes your report, and whoever started you is told and closes or continues the conversation. \`user\` only when you cannot go on without the user's reply or decision; name it in \`awaiting\`.`,
    };
  },
});
