import { sql } from "drizzle-orm";
import { z } from "zod";
import { isActiveStatus } from "../../core";
import {
  getConversationRuntime,
  listConversationsForInfra,
} from "@plugins/tasks/plugins/tasks-core/server";
import { db } from "@plugins/database/server";
import { executeRows } from "@plugins/database/plugins/sql-rows/core";
import { runTracked } from "@plugins/infra/plugins/runtime-profiler/core";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { defineWarmup } from "@plugins/infra/plugins/warmup/server";
import { createSemaphore } from "@plugins/packages/plugins/semaphore/core";
import type { BootStep } from "@plugins/framework/plugins/server-core/core";
import {
  readChainLines,
  resolveConversationTranscriptPaths,
  watchTranscriptAppends,
} from "@plugins/conversations/plugins/transcript-watcher/server";
import {
  createTurnEndTracker,
  type TurnEnd,
} from "@plugins/conversations/plugins/transcript-source/core";
import {
  _conversationTurnCompletedTriggers,
  conversationTurnCompleted,
} from "./tables-turn-completed-event";
import { databaseForkedAt } from "@plugins/database/plugins/fork-point/server";
import { isOwnConversation } from "./conversation-ownership";
import { lateTurn } from "./late-turn";

/**
 * How a turn is announced: `live` as the transcript appends it, `late` when a
 * replay hands over a turn that ended while nobody was following — which only
 * the waits armed before it ended may hear (see {@link emitEndTurn}).
 */
type Announcement = "live" | "late";

/** One followed conversation: how to stop following it, and how to announce a turn. */
interface Followed {
  unsubscribe: () => void;
  announce: (turn: TurnEnd, how: Announcement) => void;
  /** When this subscription began: a turn ending from here on is the live path's. */
  since: Date;
}

const subscriptions = new Map<string, Followed>();

/**
 * Conversations the boot started following whose waiter replay has not run:
 * the `conversations.turn-emitter-replay` warm-up runs it once the restart
 * replay settled (it ran detached from the boot hook, one transcript read per
 * waited-on conversation, inside the replay).
 */
const bootReplayPending = new Set<string>();

// Every reconcile — the boot one and each per-conversation one — runs through
// this one-at-a-time gate and reads the DB inside its turn. Otherwise the boot
// read could see X active, X→done's reconcile unsubscribe it, and boot then
// resubscribe X from its stale read. Serialized, the last writer is always the
// freshest read. A failing turn rejects its own caller and frees the gate.
const reconcileGate = createSemaphore(1);

// Followed: an active conversation of this database's own. One a fork copied
// in from main's is main's to follow, whatever its status says here — see
// `isOwnConversation`.
//
// Converges one conversation's subscription on its current DB status. The
// event that woke it is only a wake-up: out-of-order, duplicate or replayed
// events all land on the same truth.
function reconcile(conversationId: string): Promise<void> {
  return reconcileGate.run(async () => {
    const row = await getConversationRuntime(conversationId);
    const forkedAt = await databaseForkedAt();
    const active =
      row !== null &&
      isActiveStatus(row.status) &&
      isOwnConversation(row, forkedAt);
    const followed = subscriptions.get(conversationId);
    if (active && !followed) {
      const next = subscribeToConversation(conversationId);
      subscriptions.set(conversationId, next);
      void runTracked("conversations:turn-emitter-replay", () =>
        replayForWaiter(conversationId, next),
      );
    } else if (!active && followed) {
      followed.unsubscribe();
      subscriptions.delete(conversationId);
      bootReplayPending.delete(conversationId);
    }
  });
}

// Boot reconcile: subscriptions live in memory, so every restart rebuilds them
// from one read. A transition missed while the process was down is caught here
// too. Fails loudly — there is no later tick to retry.
export function startTurnEmitter(step: BootStep): Promise<void> {
  return reconcileGate.run(async () => {
    const convs = await step("rows", () => listConversationsForInfra());
    const forkedAt = await step("fork-point", () => databaseForkedAt());
    const followed = convs.filter(
      (c) =>
        isActiveStatus(c.status) &&
        isOwnConversation(c, forkedAt) &&
        !subscriptions.has(c.id),
    );
    // Subscribing returns at once: this step is the time the loop itself
    // holds the event loop. The waiter replay is the warm-up's.
    await step("subscribe", async () => {
      for (const c of followed) {
        subscriptions.set(c.id, subscribeToConversation(c.id));
        bootReplayPending.add(c.id);
      }
    });
  });
}

// Woken by conversation.created and conversation.statusChanged (see the
// Trigger contributions in the plugin barrel).
export const turnEmitterReconcileJob = defineJob({
  name: "conversations.turn-emitter.reconcile",
  description:
    "Starts or stops following a conversation's transcript as it becomes active or ends, so a finished agent turn is announced to whatever waits on it.",
  hold: "instant",
  input: z.object({}),
  dedup: "none",
  event: z.object({ conversationId: z.string() }).passthrough(),
  run: async ({ event }) => {
    if (!event) return;
    await reconcile(event.conversationId);
  },
});

// Follows one active conversation from NOW: a turn is announced when it ends
// after the subscription (the backend's boot or the conversation becoming
// active). Subscribing reads no history — only the transcript's appends, and
// a backward read of each chain file's last assistant message, the context a
// turn whose Stop hooks are still running needs. A turn that ended while the
// backend was down is not announced, as before — except to a durable workflow
// still waiting on this conversation, which gets the latest one replayed.
function subscribeToConversation(conversationId: string): Followed {
  const since = new Date();
  const tracker = createTurnEndTracker();
  // Turns this subscription announced: the waiter replay and the append stream
  // can both reach the latest turn.
  const announced = new Set<string>();
  let emitting = Promise.resolve();
  const announce = (turn: TurnEnd, how: Announcement) => {
    if (announced.has(turn.messageId)) return;
    announced.add(turn.messageId);
    emitting = emitting.then(() =>
      runTracked("conversations:turn-emitter-events", () =>
        emitEndTurn(conversationId, turn, how),
      ),
    );
  };

  const unsubscribe = watchTranscriptAppends(
    conversationId,
    lastAssistantMessage,
    ({ lines }) => {
      // A turn is over once its Stop hooks let the agent stop — not at the
      // `end_turn` text, which the CLI writes BEFORE running them: a waiter that
      // tears the agent down on that text (exit_clean's finalize) killed the
      // stop gate mid-run, and a stop a hook blocked is no end at all.
      // Seed lines were written before this subscription: they only set up
      // the turn in progress, and a turn they end was over before it.
      for (const { line, seed } of lines) {
        const ended = tracker.feed(line);
        if (ended && !seed) announce(ended, "live");
      }
    },
  );
  return { unsubscribe, announce, since };
}

/** The boot's waiter replay (see {@link bootReplayPending}). */
export const turnEmitterReplayWarmup = defineWarmup({
  name: "conversations.turn-emitter-replay",
  description:
    "Hands a turn that ended while the app was down to the durable workflow still waiting on that conversation, so the workflow goes on.",
  scope: "worktree",
  run: async () => {
    const ids = [...bootReplayPending];
    bootReplayPending.clear();
    // Each conversation's replay on its own: one that fails must not drop
    // the others' (a workflow waiting on them would never get its turn).
    const failures: unknown[] = [];
    for (const id of ids) {
      const followed = subscriptions.get(id);
      if (followed === undefined) continue;
      await runTracked("conversations:turn-emitter-replay", () =>
        replayForWaiter(id, followed),
      ).catch((err: unknown) => {
        failures.push(err);
      });
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        `[turn-emitter] ${failures.length} of ${ids.length} waiter replays failed`,
      );
  },
});

/**
 * The backward read of a file met for the first time: its lines back to the
 * newest assistant message, that message's lines included — so a turn whose
 * last message was written but whose Stop hooks have not answered is known.
 */
function lastAssistantMessage(): (
  line: Record<string, unknown>,
) => "take" | "stop" {
  let newest: unknown = undefined;
  return (line) => {
    if (line.type !== "assistant") return "take";
    const id = (line.message as { id?: unknown } | undefined)?.id;
    if (newest === undefined) {
      newest = id ?? null;
      return "take";
    }
    return id === newest ? "take" : "stop";
  };
}

/**
 * A durable workflow waiting on this conversation (a trigger row keyed to it)
 * may have missed its turn while the backend was down: hand it the latest
 * finished turn — late, so only a wait armed before that turn ended hears it.
 * A wait armed after it is waiting for a LATER turn: on 2026-11-25 a boot's
 * replay handed a 2-minute-old turn to exit_clean's finalize, armed mid-turn,
 * which closed the conversation while the agent was still writing its answer
 * (conv-1795608764-h27peb). Only for a conversation some wait was armed on
 * before that turn ended — the one case a boot reads the whole transcript.
 */
async function replayForWaiter(
  conversationId: string,
  followed: Pick<Followed, "announce" | "since">,
): Promise<void> {
  const firstArmedAt = await firstTriggerArmedAt(conversationId);
  if (firstArmedAt === null) return;
  const turn = lateTurn(
    await readChainLines(
      await resolveConversationTranscriptPaths(conversationId),
    ),
    { firstArmedAt, followedSince: followed.since },
  );
  if (turn !== null) followed.announce(turn, "late");
}

// A late turn reaches only the triggers armed by the time it ended
// (`armedBefore`): a wait armed after it is waiting on a later turn. A live one
// reaches every trigger — a wait armed a moment after the turn's end line was
// written (the finalize of an exit_clean called near the turn's end) is
// waiting on exactly that turn.
async function emitEndTurn(
  conversationId: string,
  turn: TurnEnd,
  how: Announcement,
): Promise<void> {
  try {
    await conversationTurnCompleted.emit(
      {
        conversationId,
        stopReason: "end_turn",
        text: turn.text,
        messageId: turn.messageId,
      },
      how === "late" ? { armedBefore: new Date(turn.endedAt) } : undefined,
    );
    // eslint-disable-next-line promise-safety/no-bare-catch
  } catch (err) {
    console.error(
      `[conversations.turn-emitter] emit failed for ${conversationId}`,
      err,
    );
  }
}

// When the first enabled trigger row keyed to this conversation was armed — a
// durable workflow may be waiting on it — or null when there is none.
async function firstTriggerArmedAt(
  conversationId: string,
): Promise<Date | null> {
  const rows = await executeRows(db, {
    label: "conversation.turn-completed first trigger",
    query: sql`SELECT min(created_at) AS armed_at
        FROM ${_conversationTurnCompletedTriggers}
        WHERE enabled = true AND conversation_id = ${conversationId}`,
    row: z.object({ armed_at: z.coerce.date().nullable() }),
  });
  return rows[0]?.armed_at ?? null;
}
