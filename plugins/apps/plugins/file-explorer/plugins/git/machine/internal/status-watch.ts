import type { CheckoutWatchRequest } from "@plugins/infra/plugins/git/plugins/checkout-watch/server";

/**
 * What the git status reads, beside the working tree, HEAD and the index:
 * `--branch`'s ahead/behind (the own branch and its upstream), and
 * `refs/heads/main` — the merge-base the vs-main half diffs against moves
 * with it (a push landing the branch on main empties it). The checkout watch
 * already dropped the paths git ignores (a build writing `.cache/`, another
 * worktree under `.claude/`), so every batch heard can move the status; a lost
 * watch re-reads it whole.
 */
export function gitStatusWatch(notify: () => void): CheckoutWatchRequest {
  return {
    refs: { also: ["refs/heads/main"], upstream: true },
    onChange: () => notify(),
    onResync: () => notify(),
  };
}
