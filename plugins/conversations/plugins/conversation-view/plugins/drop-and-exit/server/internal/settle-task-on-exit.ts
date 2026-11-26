import { getAttemptStanding } from "@plugins/tasks/plugins/attempt-work/server";
import {
  deliverTaskIfNoActiveSibling,
  dropTaskIfNoActiveSibling,
} from "@plugins/tasks/plugins/tasks-core/server";
import type { Conversation } from "@plugins/tasks/plugins/tasks-core/core";
import { exitSettlement, type ExitClose } from "../../core/drop-policy";

/** What a close did to its task: what `exitSettlement` asked, or `"kept"`. */
export type ExitSettled = "dropped" | "delivered" | "kept";

/**
 * The one exit-settlement policy, shared by every conversation-close path that
 * can settle a task: the manual "Drop & Close" exit-menu action drops a task
 * whose work has not landed; the agent-driven `exit_clean` never drops, and
 * delivers an attempt with nothing to land (finished non-code work — the task
 * reads `done`; see `ExitClose`). Either way a task does not stay stranded as
 * `attempted` with nothing at stake.
 *
 * Never drop or deliver when work is at stake OR unmeasurable:
 *
 * - **Unknown state is not a licence to drop a task.** `getAttemptStanding` returns a
 *   `Resolvable`, and its unresolved arm means the standing could not be
 *   measured at all (the attempt row is gone). Leaving the task as `attempted`
 *   is recoverable by a human; dropping work we cannot account for is not.
 * - **The standing is git-measured, so it cannot lag behind a background job.**
 *   This guard used to live in `tasks-core` and read the `pushes` ledger, where
 *   an empty result was taken as proof that nothing was pushed. That ledger was
 *   written by a background job, and while the job lagged the table was empty for
 *   work already merged into `main` — so an agent that pushed and then exited
 *   cleanly had its task dropped with no UI involved. (The ledger is a git-derived
 *   projection now, but its emptiness still is not evidence: it records only what
 *   landed, and only commits that carry a trailer.)
 * - **The standing is a decision read** (`getAttemptStanding`): `main` as git
 *   holds it at this instant, one snapshot for every count, and uncommitted
 *   work in the checkout counts as pending — an agent never commits, so work
 *   held for review lives only there.
 * - **`standingOf` is a discriminated value, not a count.** There is no array
 *   here whose emptiness could be misread, and the drop is reachable only from a
 *   measured standing that `close` allows (see `exitSettlement`): the manual
 *   action drops anything not yet in `main`; the agent-driven close delivers
 *   only a measured `"none"`. Required, so each caller states which close it is.
 * - **A sibling still working keeps the task as it is**: another conversation
 *   may land the work (tasks-core's `…IfNoActiveSibling`).
 *
 * Design: research/2026-08-17-global-attempt-work-git-derived-standing.md.
 *
 * `conversation.attemptId` is a non-nullable `string` column, so there is no
 * "conversation without an attempt" case to route around — a missing attempt ROW
 * surfaces as the unresolved arm above, which is already non-droppable.
 *
 * Returns what it did to the task.
 */
export async function settleTaskOnExit(
  conversation: Conversation,
  close: ExitClose,
): Promise<ExitSettled> {
  const standing = await getAttemptStanding(conversation.attemptId);
  if (!standing.resolved) return "kept";
  switch (exitSettlement(standing.value, close)) {
    case "keep":
      return "kept";
    case "drop":
      return (await dropTaskIfNoActiveSibling(conversation))
        ? "dropped"
        : "kept";
    case "deliver":
      return (await deliverTaskIfNoActiveSibling(
        conversation,
        "Closed with exit_clean: finished with nothing to land.",
      ))
        ? "delivered"
        : "kept";
  }
}
