import type {
  DirWatchRequest,
  FileChangeEvent,
} from "@plugins/infra/plugins/file-watcher/server";
import {
  createCheckoutWatchHub,
  type CheckoutWatchRelease,
  type CheckoutWatchRequest,
} from "../internal/hub";

/**
 * A checkout watch over fake directories, for testing what a reader's request
 * hears: one linked worktree at `/wt` (git dir `/main/.git/worktrees/wt`, on
 * `refs/heads/wt-branch` tracking `refs/remotes/origin/wt-branch`, nothing
 * ignored), driven by the real hub — so `refs`, `onChange` and `onResync` are
 * judged exactly as `acquireCheckoutWatch` judges them.
 */
export function fakeCheckoutWatch() {
  const live = new Map<string, DirWatchRequest>();
  const hub = createCheckoutWatchHub({
    locate: async () => ({
      gitDir: "/main/.git/worktrees/wt",
      commonDir: "/main/.git",
      infoDir: "/main/.git/info",
    }),
    readBranch: async () => ({
      own: "refs/heads/wt-branch",
      upstream: "refs/remotes/origin/wt-branch",
    }),
    ignored: async () => new Set<string>(),
    acquireDirWatch: async (req) => {
      live.set(req.dir, req);
      return () => void live.delete(req.dir);
    },
    refreshIndex: async () => {},
  });
  const watch = (dir: string): DirWatchRequest => {
    const req = live.get(dir);
    if (req === undefined)
      throw new Error(`[fake checkout watch] ${dir} is not watched`);
    return req;
  };
  return {
    root: "/wt",
    acquire: (request: CheckoutWatchRequest): Promise<CheckoutWatchRelease> =>
      hub.acquire("/wt", request),
    /** A write of one shared ref, alone (`refs/heads/main` advancing). */
    moveRef(ref: string): void {
      const event: FileChangeEvent = {
        type: "update",
        path: `/main/.git/${ref}`,
      };
      void watch("/main/.git/refs").onChange([event]);
    },
    /** The working tree's native watch dropped events. */
    loseEvents(): void {
      const { onLost } = watch("/wt");
      if (onLost === undefined)
        throw new Error("[fake checkout watch] no onLost on /wt");
      onLost(new Error("overflow"));
    },
  };
}
