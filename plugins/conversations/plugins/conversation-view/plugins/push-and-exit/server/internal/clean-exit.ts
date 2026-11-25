import { updateConversation } from "@plugins/tasks/plugins/tasks-core/server";
import { exitCleanRefusals } from "@plugins/conversations/plugins/conversation-view/plugins/push-and-exit/plugins/exit-precondition/server";
import { exitCleanFinalizeJob } from "./exit-clean-finalize-job";

/**
 * Close `conversationId` cleanly — `exit_clean`'s whole path, for it and for
 * any tool that ends a conversation the same way (a supervisor's `handoff`):
 * every exit precondition is checked first; when one fails nothing is written
 * and its messages are returned. Otherwise `beforeClose` runs (the caller's
 * own write, which must exist only if the close goes ahead), then the
 * conversation is marked close-requested and closed once its turn ends.
 * Returns the refusals, empty when the close is under way.
 */
export async function requestCleanExit(
  conversationId: string,
  opts: {
    beforeClose?: () => Promise<void>;
    /** The task's work goes on in a successor that takes over what this
     * conversation holds (`CleanExitKind`). */
    handedOver?: boolean;
  } = {},
): Promise<string[]> {
  const refusals = await exitCleanRefusals(conversationId, {
    handedOver: opts.handedOver ?? false,
  });
  if (refusals.length > 0) return refusals;
  await opts.beforeClose?.();
  await updateConversation(conversationId, { closeRequested: true });
  await exitCleanFinalizeJob.enqueue({ conversationId });
  return [];
}
