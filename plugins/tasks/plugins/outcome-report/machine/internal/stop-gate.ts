import { StopGate } from "@plugins/conversations/plugins/stop-gate/server";
import { getConversation } from "@plugins/tasks/plugins/tasks-core/server";
import { grantOf } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { reportRequired } from "@plugins/tasks/plugins/outcome-report/plugins/capability/core";
import { TURN_FOR_TOOL } from "./report-line";
import { readRunState, userInRun } from "./run-state";

/**
 * Once the user has talked to an agent whose runs are handed back, each of
 * its turns is for the user or for whoever started it — and only the agent
 * knows which. So it may not stop until it said (`turn_for`, after the user's
 * latest word). A run nobody but its starter is in needs no call: its end is
 * handed back as is. No flaw: who a reply is meant for is the agent's call,
 * and no API can derive it.
 */
export const turnForStopGate = StopGate({
  id: "outcome-report.turn-for",
  async check(conversationId) {
    if ((await grantOf(reportRequired, conversationId)) === null)
      return { kind: "allow" };
    const conversation = await getConversation(conversationId);
    if (conversation === null) return { kind: "allow" };
    const state = await readRunState(conversation);
    if (!userInRun(state) || state.addressee !== null) return { kind: "allow" };
    return {
      kind: "block",
      reason: `The user has talked to you in this run, so say whom this turn is for before you stop: call \`${TURN_FOR_TOOL}\` with \`user\` (your reply is theirs; nobody else is told) or \`supervisor\` (your last message is handed back as your report to whoever started you).`,
    };
  },
});
