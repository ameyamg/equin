import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { createKeyedMutex } from "@plugins/packages/plugins/keyed-mutex/core";
import { ConversationStatusSchema } from "@plugins/tasks/plugins/tasks-core/core";
import { getConversation } from "@plugins/tasks/plugins/tasks-core/server";
import { isAgentBusy } from "@plugins/conversations/core";
import { readConversationTurns } from "@plugins/conversations/server";
import { grantOf } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { reportRequired } from "@plugins/tasks/plugins/outcome-report/plugins/capability/core";
import { wakeReasons } from "@plugins/conversations/plugins/stop-gate/server";
import { _handBacks, _turnAddressees } from "../../server/internal/tables";
import { outcomeReportHandedBack } from "../../server/internal/tables-events";
import { readRunState, runEnd } from "./run-state";

/** One finished turn of an agent: its last message and when it ended. */
export interface EndedTurn {
  text: string;
  messageId: string | null;
  endedAt: Date;
}

// The live path and the backstop may judge the same turn at once: one at a
// time per conversation, so the second sees the first's hand-back and skips.
const handBackLock = createKeyedMutex("outcome-report.hand-back");

/**
 * Hands a run back at its turn's end: the agent's last message is what
 * whoever started it hears — no tool writes it, so an agent cannot stop
 * without reporting. `runEnd` decides, as the run stood when the turn ended,
 * whether this end is the run's; the turn's `turn_for`, if any, is used up
 * either way, so the next turn says again. Then the marker (which message,
 * when) and the event whoever waits on the run hears (a watcher's `reported`,
 * an automation's slot). A message already handed back is not handed back
 * again.
 */
export function handBackTurn(
  conversationId: string,
  turn: EndedTurn,
): Promise<void> {
  return handBackLock.run(conversationId, async () => {
    if ((await grantOf(reportRequired, conversationId)) === null) return;
    const conversation = await getConversation(conversationId);
    if (conversation === null) return;
    const [last] = await db
      .select({ messageId: _handBacks.messageId })
      .from(_handBacks)
      .where(eq(_handBacks.conversationId, conversationId));
    if (turn.messageId !== null && last?.messageId === turn.messageId) return;
    const state = await readRunState(conversation, turn.endedAt);
    const decision = runEnd(state, await wakeReasons(conversationId));
    if (decision === "hand-back") {
      const marker = {
        messageId: turn.messageId,
        handedBackAt: turn.endedAt,
      };
      await db
        .insert(_handBacks)
        .values({ conversationId, ...marker })
        .onConflictDoUpdate({ target: _handBacks.conversationId, set: marker });
      await outcomeReportHandedBack.emit({
        taskId: conversation.taskId,
        conversationId,
        body: turn.text,
      });
    }
    // Used up, not deleted: a used `user` row is the turn's recorded verdict
    // (it rests on the user), read by the digest's `waiting on the user`.
    if (state.declaredAt !== undefined)
      await db
        .update(_turnAddressees)
        .set({ usedAt: turn.endedAt })
        .where(
          and(
            eq(_turnAddressees.conversationId, conversationId),
            eq(_turnAddressees.declaredAt, state.declaredAt),
          ),
        );
  });
}

export const handBackJob = defineJob({
  name: "outcome-report.hand-back",
  description:
    "At the end of an agent's turn, when its mandate hands its runs back: if the run is over (nobody but its starter in it and nothing will wake it, or the agent said the turn is for its supervisor), tells whoever started it, with its last message.",
  hold: "instant",
  input: z.object({}),
  // Concurrent runs for one conversation queue on handBackLock.
  dedup: "none",
  event: z
    .object({
      conversationId: z.string(),
      text: z.string(),
      messageId: z.string().nullable(),
      endedAt: z.string(),
    })
    .passthrough(),
  run: async ({ event }) => {
    if (!event) return;
    await handBackTurn(event.conversationId, {
      text: event.text,
      messageId: event.messageId,
      endedAt: new Date(event.endedAt),
    });
  },
});

/**
 * The backstop for a turn whose end nobody announced — it ended while the
 * backend was down, and `conversation.turn-completed` replays a missed turn
 * only to a wait keyed to that conversation. Every stop (a durable
 * `conversation.statusChanged` to a status at rest, waiting on nothing) of a
 * conversation under the grant reads its last finished turn from the
 * transcript and judges it like the live path; a turn already handed back is
 * skipped by its message id.
 */
export const handBackBackstopJob = defineJob({
  name: "outcome-report.hand-back-backstop",
  description:
    "When an agent whose runs are handed back comes to rest, hands back its last finished turn if no turn-end announcement did (the backend was down when it ended).",
  hold: "instant",
  input: z.object({}),
  dedup: "none",
  event: z
    .object({
      conversationId: z.string(),
      status: ConversationStatusSchema,
      waitingFor: z.string().nullable(),
    })
    .passthrough(),
  run: async ({ event }) => {
    if (!event) return;
    if (isAgentBusy(event.status) || event.waitingFor !== null) return;
    const { conversationId } = event;
    if ((await grantOf(reportRequired, conversationId)) === null) return;
    const turns = await readConversationTurns(conversationId);
    const last = turns.at(-1);
    if (
      last === undefined ||
      last.role !== "assistant" ||
      last.stopReason !== "end_turn"
    )
      return;
    await handBackTurn(conversationId, {
      text: last.text,
      messageId: last.messageId ?? null,
      endedAt: new Date(last.at),
    });
  },
});
