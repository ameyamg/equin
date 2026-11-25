import { handOverDecisions } from "@plugins/tasks/plugins/decisions/server";
import { taskIdKind } from "@plugins/tasks/plugins/task-ids/core";
import { SessionHandoff } from "@plugins/tasks/plugins/supervisor-roles/plugins/sessions/server";

/**
 * A hand-off takes the ending session's open decisions along: they move to
 * the new session's root, so the user's answers reach the agent that now runs
 * the role. What lets the tool pass `handedOver` to the exit check (the
 * decisions precondition stands aside for a hand-over).
 */
export const decisionsCarry = SessionHandoff.Carry({
  id: "decisions",
  async carry(fromTaskId, toTaskId, tx) {
    const labels = await handOverDecisions(
      taskIdKind.key(fromTaskId),
      taskIdKind.key(toTaskId),
      tx,
    );
    return labels.length === 0
      ? null
      : `Its open decisions are yours now (the user's answers come to you): ${labels.join(", ")} — \`list_decisions\` shows them.`;
  },
});
