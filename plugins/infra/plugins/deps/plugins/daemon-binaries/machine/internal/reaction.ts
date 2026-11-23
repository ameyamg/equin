import { defineRefReaction } from "@plugins/infra/plugins/git/plugins/git-watcher/server";

const listeners = new Set<() => void>();

/** Run `fn` whenever main advances. Returns the unsubscribe. */
export function onMainMoved(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Main moved: its bun.lock may now declare another version of a daemon's
 * binaries (an upgrade landed), which the daemon runs from its next start —
 * the row re-reads, in every backend, since a worktree's backend is not
 * restarted by a push.
 */
export const daemonBinariesReaction = defineRefReaction({
  name: "deps.daemon-binaries",
  refName: "refs/heads/main",
  run: async () => {
    for (const fn of listeners) fn();
  },
});
