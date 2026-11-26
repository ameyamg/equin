import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { DbExecutor } from "@plugins/database/server";
import {
  turnIdKind,
  type TurnId,
} from "@plugins/conversations/plugins/turn-ledger/core";
import { _tasks } from "@plugins/tasks/plugins/tasks-core/server";
import { sha256Hex } from "@plugins/packages/plugins/string-hash/core";
import type {
  HeldTurn,
  TurnReadiness,
} from "@plugins/conversations/plugins/automatic-turn/server";
import { QUIET_EVENT_KIND, type WatchEvent, type WatchId } from "../../core";
import type { WatchHandlerEntry } from "./contributions";
import { getWatch, isWatchLive, nearestLiveWatch } from "./queries";
import { evaluateQuiet } from "./quiet";
import { _watchInbox } from "./tables";

/** What delivery reads and does outside the inbox: ports, so a test drives the
 * policy over the real tables with a fake agent. */
export interface DeliverPorts {
  /** Whether an automatic turn may be typed into the watcher conversation
   * now (conversations/automatic-turn), read on the delivery's transaction. */
  readiness(conversationId: string, exec: DbExecutor): Promise<TurnReadiness>;
  /** Submit one `event` turn. `onRecorded` runs on the transaction that
   * records it in the turn ledger (a throw rolls that record back, typing
   * nothing). `duplicate`: the ledger had `turnId` already, so `onRecorded`
   * did not run. `stopped`: the conversation stopped (`gone` / `done`) after
   * the claim read it — an event never reopens it, so nothing was recorded. */
  submit(
    conversationId: string,
    turnId: TurnId,
    text: string,
    onRecorded: (tx: DbExecutor) => Promise<void>,
  ): Promise<{ kind: "recorded" | "duplicate" | "stopped" }>;
  /** The tree digest appended to the turn (advances the watcher's cursor). */
  digest(conversationId: string): Promise<string | null>;
  handler(id: string): WatchHandlerEntry | undefined;
}

export type DeliverOutcome =
  | { kind: "not-found" }
  | { kind: "empty" }
  /** The watcher cannot take a turn now (stopped `gone`, busy, waiting on
   * the user, or another plugin's turn goes first); its next status change
   * re-runs delivery. */
  | HeldTurn
  /** The watch is dead: its rows moved to `to` (each needs a delivery). */
  | { kind: "rerouted"; to: WatchId[]; dropped: number }
  /** A code watcher's batch, handled on the claiming transaction. */
  | { kind: "delivered"; turnId: string; count: number }
  /** A conversation watcher's rows, gathered into one turn that is not sent
   * yet: `sendClaimedTurn` sends it once the read committed. */
  | ClaimedTurn;

/** A conversation watcher's undelivered rows, to be sent as one turn. Nothing
 * is written for it until the turn is recorded (`sendClaimedTurn`). */
export interface ClaimedTurn {
  kind: "claimed";
  watchId: WatchId;
  conversationId: string;
  turnId: TurnId;
  rowIds: InboxRow["id"][];
  events: WatchEvent[];
  titles: ReadonlyMap<string, string>;
}

/** The turn a batch is: a uuid-shaped digest of its row ids, so delivering
 * the same rows again is the same turn (submitTurn no-ops on it). */
export function turnIdFor(rowIds: readonly string[]): TurnId {
  const hex = sha256Hex([...rowIds].sort().join(","));
  return turnIdKind.parse(
    `turn-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`,
  );
}

type InboxRow = typeof _watchInbox.$inferSelect;

function toEvent(r: InboxRow): WatchEvent {
  return {
    id: r.id,
    kind: r.kind,
    taskId: r.taskId,
    actorConversationId: r.actorConversationId,
    summary: r.summary,
    payload: r.payload,
    createdAt: r.createdAt,
  };
}

/** One event turn: a line per event (kind · task · title — summary, a
 * multi-line summary indented under it), then the digest. */
export function renderEventTurn(
  events: readonly WatchEvent[],
  titles: ReadonlyMap<string, string>,
  digest: string | null,
): string {
  const lines = events.map((e) => {
    const [first = "", ...rest] = e.summary.split("\n");
    const title = titles.get(e.taskId);
    const head = `- ${e.kind} · ${e.taskId}${title === undefined ? "" : ` ${JSON.stringify(title)}`} — ${first}`;
    return rest.length === 0
      ? head
      : [head, ...rest.map((l) => (l === "" ? "" : `    ${l}`))].join("\n");
  });
  const header =
    events.length === 1
      ? "An event in the tasks you watch:"
      : `${events.length} events in the tasks you watch:`;
  return [header, ...lines, ...(digest ? ["", digest] : [])].join("\n");
}

async function undelivered(
  exec: DbExecutor,
  watchId: WatchId,
): Promise<InboxRow[]> {
  return exec
    .select()
    .from(_watchInbox)
    .where(
      and(
        eq(_watchInbox.watchId, watchId),
        isNull(_watchInbox.deliveredInTurn),
      ),
    )
    .orderBy(asc(_watchInbox.createdAt), asc(_watchInbox.id))
    .for("update");
}

/** The rows changed under the batch while it was being sent (a `quiet`
 * withdrawn, another delivery recorded some of them first): the turn is not
 * recorded, and delivery runs again over what is left. */
export class BatchChangedError extends Error {
  constructor(watchId: WatchId, turnId: TurnId) {
    super(
      `watch ${watchId}: the rows of turn ${turnId} changed before it was recorded`,
    );
    this.name = "BatchChangedError";
  }
}

/**
 * Mark rows delivered in `turnId` — the ONLY write of `delivered_in_turn`,
 * and never undone: it runs on the transaction that records the turn (or, for
 * a code watcher, that hands it the batch), so a row is delivered exactly when
 * its turn exists. Nothing asks the ledger afterwards — its settled rows are
 * swept after 7 days, and reading "no row" as "never sent" replayed week-old
 * events as new (2026-11-21/22). Throws {@link BatchChangedError} unless every
 * row was still this watch's and undelivered.
 */
async function markDelivered(
  exec: DbExecutor,
  watchId: WatchId,
  ids: readonly InboxRow["id"][],
  turnId: TurnId,
): Promise<void> {
  const marked = await exec
    .update(_watchInbox)
    .set({ deliveredInTurn: turnId })
    .where(
      and(
        inArray(_watchInbox.id, [...ids]),
        eq(_watchInbox.watchId, watchId),
        isNull(_watchInbox.deliveredInTurn),
      ),
    )
    .returning({ id: _watchInbox.id });
  if (marked.length !== ids.length)
    throw new BatchChangedError(watchId, turnId);
}

/**
 * Claim a watch's undelivered events — run on ONE transaction (`exec`).
 *
 * - A dead watch (ended, or its conversation `done`) hands its rows to the
 *   next live watch above each row's task; rows no live watch covers drop.
 * - A conversation watcher that cannot take an automatic turn now is held
 *   (`ports.readiness`): busy (the turn would be folded into the running
 *   one), waiting on the user (it would answer their question), or another
 *   plugin's turn is pending for it (it goes first — typed after ours it
 *   would reach a busy CLI).
 * - A `quiet` row is re-checked first: withdrawn when the subtree is not
 *   quiet now (an agent launched while the watcher was held).
 * - Otherwise every undelivered row goes into ONE turn (or ONE code batch),
 *   whose id is derived from the rows. A code batch is handled and marked
 *   delivered here; a conversation turn is only gathered (`claimed`, nothing
 *   written) — `sendClaimedTurn` sends it AFTER this transaction commits and
 *   marks the rows on the transaction that records the turn.
 *
 * Never send the turn on the claiming transaction: submitting a turn opens
 * transactions of its own (the turn ledger) and may resume the agent, so a
 * claim held across it pins a background transaction lease while waiting for
 * another. Three deliveries at once took every lease and each waited for a
 * fourth — wedging every background transaction in the backend (2026-10-30).
 */
export async function claimDelivery(
  exec: DbExecutor,
  watchId: WatchId,
  ports: DeliverPorts,
): Promise<DeliverOutcome> {
  const watch = await getWatch(exec, watchId);
  if (watch === null) return { kind: "not-found" };

  if (!(await isWatchLive(exec, watchId))) {
    const rows = await undelivered(exec, watchId);
    const to = new Set<WatchId>();
    let dropped = 0;
    for (const row of rows) {
      const target = await nearestLiveWatch(
        exec,
        row.taskId,
        row.actorConversationId,
      );
      if (target === null) {
        await exec.delete(_watchInbox).where(eq(_watchInbox.id, row.id));
        dropped++;
        continue;
      }
      await exec
        .update(_watchInbox)
        .set({ watchId: target.id })
        .where(eq(_watchInbox.id, row.id));
      to.add(target.id);
    }
    return { kind: "rerouted", to: [...to], dropped };
  }

  const { watcher } = watch;
  if (watcher.kind === "conversation") {
    const readiness = await ports.readiness(watcher.conversationId, exec);
    if (readiness.kind === "not-found")
      throw new Error(
        `watch ${watchId}: its conversation ${watcher.conversationId} does not exist`,
      );
    if (readiness.kind === "held") return readiness;
  }

  let rows = await undelivered(exec, watchId);
  // A `quiet` row is a claim about the present, recorded maybe long before
  // (the watcher was held): asked again now, a subtree that came back to life
  // withdraws it (evaluateQuiet) rather than telling the watcher it is idle.
  if (rows.some((r) => r.kind === QUIET_EVENT_KIND)) {
    await evaluateQuiet(exec, watchId);
    rows = await undelivered(exec, watchId);
  }
  if (rows.length === 0) return { kind: "empty" };
  const ids = rows.map((r) => r.id);
  const turnId = turnIdFor(ids);
  const events = rows.map(toEvent);

  if (watcher.kind === "code") {
    const handler = ports.handler(watcher.handler);
    if (handler === undefined)
      throw new Error(
        `watch ${watchId}: no WatchHandler "${watcher.handler}" is contributed`,
      );
    await markDelivered(exec, watchId, ids, turnId);
    await handler.onEvents(events, { watch, tx: exec });
    return { kind: "delivered", turnId, count: rows.length };
  }
  const taskIds = [...new Set(events.map((e) => e.taskId))];
  const titleRows = await exec
    .select({ id: _tasks.id, title: _tasks.title })
    .from(_tasks)
    .where(inArray(_tasks.id, taskIds));
  return {
    kind: "claimed",
    watchId,
    conversationId: watcher.conversationId,
    turnId,
    rowIds: ids,
    events,
    titles: new Map(titleRows.map((t) => [t.id, t.title])),
  };
}

/**
 * Send a gathered batch as one `event` turn, on no transaction. Its rows are
 * marked delivered on the transaction that records the turn, so a send that
 * never recorded one (it threw first, the conversation stopped, the backend
 * died) leaves them undelivered for the next run — and a recorded turn is
 * never sent again, whatever becomes of its ledger row later. `changed`: the
 * rows moved under it ({@link BatchChangedError}), or another delivery of the
 * same rows recorded the turn first; the caller runs delivery again.
 * `stopped`: the watcher stopped between the claim and the send (closed that
 * very moment — 2026-11-26, conv-1794746872-ocqsyj). Nothing was recorded,
 * and the caller runs delivery again, which decides from the new status: a
 * `done` watcher's watch is dead, so its rows re-route; a `gone` one is held
 * (readiness `stopped`) until it is resumed. Never a throw: a retry of the
 * same send can only fail the same way.
 */
export async function sendClaimedTurn(
  exec: DbExecutor,
  claim: ClaimedTurn,
  ports: DeliverPorts,
): Promise<
  | { kind: "delivered"; turnId: string; count: number }
  | { kind: "changed" }
  | { kind: "stopped" }
> {
  const digest = await ports.digest(claim.conversationId);
  try {
    const out = await ports.submit(
      claim.conversationId,
      claim.turnId,
      renderEventTurn(claim.events, claim.titles, digest),
      (tx) => markDelivered(tx, claim.watchId, claim.rowIds, claim.turnId),
    );
    if (out.kind === "stopped") return { kind: "stopped" };
    // The ledger has this turn already: another delivery of the same rows
    // recorded it first, marking them on that transaction. Rows still
    // unmarked under a recorded turn would break the one invariant here.
    if (out.kind === "duplicate") {
      const marked = await exec
        .select({ id: _watchInbox.id })
        .from(_watchInbox)
        .where(
          and(
            inArray(_watchInbox.id, claim.rowIds),
            eq(_watchInbox.deliveredInTurn, claim.turnId),
          ),
        );
      if (marked.length !== claim.rowIds.length)
        throw new Error(
          `watch ${claim.watchId}: turn ${claim.turnId} is in the ledger, but ${claim.rowIds.length - marked.length} of its rows are not marked delivered in it`,
        );
      return { kind: "changed" };
    }
  } catch (err) {
    if (err instanceof BatchChangedError) return { kind: "changed" };
    throw err;
  }
  return {
    kind: "delivered",
    turnId: claim.turnId,
    count: claim.events.length,
  };
}
