import { z } from "zod";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { afterTurn, deleteConversation } from "@plugins/conversations/server";
import {
  getConversation,
  markConversationClosed,
} from "@plugins/tasks/plugins/tasks-core/server";
import { settleTaskOnExit } from "@plugins/conversations/plugins/conversation-view/plugins/drop-and-exit/server";
import { recordNotification } from "@plugins/shell/plugins/notifications/server";
import { conversationRoute } from "@plugins/conversations/core";
import { agentManagerApp } from "@plugins/apps/plugins/agent-manager/plugins/shell/core";
import { conversationName } from "@plugins/tasks/plugins/tasks-core/core";
import { symbol } from "@plugins/ui/plugins/icons/core";

const finishedIcon = symbol("check-circle");

const FINALIZE_TIMEOUT_MS = 60_000;

// Spawned by the `exit_clean` MCP tool. Defers `deleteConversation` until
// after the model's current turn ends — its Stop hooks included — so the
// closing agent kill races neither a still-streaming response nor the stop
// gate (killed mid-run, it showed as a Stop hook error on every clean exit). If end_turn doesn't arrive
// within FINALIZE_TIMEOUT_MS we delete anyway — the model has already
// signalled clean exit, so missing the end_turn (transcript poll lag,
// missed event) shouldn't strand the conversation.
export const exitCleanFinalizeJob = defineJob({
  name: "push_and_exit.exit_clean_finalize",
  description:
    "Closes a conversation after the agent signals a clean exit, once its current turn ends, and notifies the user.",
  // seconds — and NOT `minutes`, despite FINALIZE_TIMEOUT_MS being 60s: that
  // number bounds a `ctx.waitFor`, which RETURNS from `run` and releases the
  // slot. The wait costs no hold at all. What this classifies is the resumed
  // dispatch: `settleTaskOnExit` (git-measured attempt standing) plus one untimed
  // agent stop, both bounded local operations.
  hold: "seconds",
  input: z.object({ conversationId: z.string() }),
  // Direct-enqueue only (spawned by the exit_clean MCP tool).
  event: z.never(),
  dedup: { key: (input) => input.conversationId },
  maxAttempts: 3,
  run: async ({ input: { conversationId }, ctx }) => {
    await afterTurn(ctx, conversationId, { timeoutMs: FINALIZE_TIMEOUT_MS });
    await ctx.step("close-conversation", async () => {
      // The agent closed its run as finished, so its task is settled, never
      // dropped (no person chose to drop): nothing to land is finished
      // non-code work — the attempt records a delivery and the task reads
      // `done`; landed work already reads `done`; pending work (or a standing
      // that cannot be measured) stays `attempted`. See drop-and-exit's
      // `ExitClose`. It used to drop on nothing to land, which read every
      // finished investigation, filing and design as abandoned
      // (task-1795653352-zsoo64).
      const conversation = await getConversation(conversationId);
      const settled = conversation
        ? await settleTaskOnExit(conversation, "exit-clean")
        : "kept";

      await markConversationClosed(conversationId);
      await deleteConversation(conversationId);
      // Server-side terminus of the clean push-and-exit flow: persist the
      // close notification exactly once (the client used to fire this toast
      // from a per-tab effect, duplicating the row per open tab). The copy
      // says when the run finished with nothing to land.
      //
      // TODO(§4, research/2026-10-25-global-notifications-in-user-terms.md):
      // both are sent only while the user is not watching the conversation
      // (`unlessWatching`). Until the watching presence lands they are sent
      // always.
      await recordNotification({
        type: "conversation",
        category: "conversations",
        icon: finishedIcon,
        title:
          settled === "delivered"
            ? "Finished without changes"
            : "Conversation finished",
        description: "",
        subjectId: conversationId,
        subjectName: conversation ? conversationName(conversation) : null,
        detail:
          settled === "delivered"
            ? "exit_clean with nothing to land — task marked done"
            : "exit_clean — conversation closed",
        variant: "info",
        action: {
          kind: "open",
          payload: {
            to: conversationRoute.link(agentManagerApp, {
              convId: conversationId,
            }),
          },
        },
        dedupeKey: `push-and-exit-clean:${conversationId}`,
      });
    });
  },
});
