import type { Standing } from "@plugins/tasks/plugins/attempt-work/core";

/**
 * Who closed the conversation — each close settles its task its own way.
 *
 * - `"drop-and-close"` — the user picked Drop & Close from the exit menu: a
 *   person chose to drop. Only work already in `main` makes the task
 *   "complete"; committed-but-unmerged work (a push that never finished) is
 *   still not landed, so the task drops. Dropping only flips the task's status
 *   — the branch and its commits stay.
 * - `"exit-clean"` — the agent closed its own run as finished (`exit_clean`:
 *   "your work is finished — the branch landed, or there was nothing to land").
 *   No person chose to drop, so it NEVER drops. Nothing to land is finished
 *   non-code work (an investigation, a filed issue, a design: the run's report
 *   is the outcome), so the attempt records a delivery and the task reads
 *   `done`. An agent that did not finish has its own exits — `flag_raise`, or
 *   simply stopping — and neither reaches here. It used to drop on `none`
 *   (`"only-if-no-work"`), which read "no code changed" as "nothing was done":
 *   26 finished tasks with an outcome report read Dropped in one week
 *   (task-1795653352-zsoo64).
 */
export type ExitClose = "drop-and-close" | "exit-clean";

/**
 * What a close settles the task to: `drop` it, `deliver` the attempt (the task
 * reads `done`), or `keep` it as it stands (landed work already reads `done`;
 * pending work stays `attempted` for someone to push).
 */
export type ExitSettlement = "drop" | "deliver" | "keep";

/** How a `close` settles a task whose attempt stands at `standing`. */
export function exitSettlement(
  standing: Standing,
  close: ExitClose,
): ExitSettlement {
  switch (close) {
    case "drop-and-close":
      return standing === "landed" ? "keep" : "drop";
    case "exit-clean":
      return standing === "none" ? "deliver" : "keep";
  }
}
