import {
  armAwakeDeadline,
  type AwakeClock,
} from "@plugins/packages/plugins/deadline/core";
import type { AgentProjection } from "../../server/internal/reducer";

// The runtime's "wait until the agent did X" (started, initialized, settled
// after an interrupt): waiters on the projection the consumer applies.

/** A wait's bound of awake time ran out. */
export class ProjectionTimeoutError extends Error {
  constructor(id: string, what: string, budgetMs: number) {
    super(
      `SDK agent ${id}: ${what} did not happen within ${budgetMs}ms of awake time`,
    );
    this.name = "ProjectionTimeoutError";
  }
}

/** The caller stopped waiting (its signal aborted). */
export class ProjectionWaitAbortedError extends Error {
  constructor(id: string, what: string) {
    super(`SDK agent ${id}: stopped waiting for ${what}`);
    this.name = "ProjectionWaitAbortedError";
  }
}

type Waiter = {
  until: (s: AgentProjection) => boolean;
  resolve: (s: AgentProjection) => void;
};

export function createProjectionWaits(deps: {
  /** The projection as stored. */
  current: (id: string) => Promise<AgentProjection | null | undefined>;
  /** Start a catch-up of `id`, without waiting for it. */
  catchUp: (id: string) => void;
  /** Injected by tests. */
  clock?: AwakeClock;
}) {
  const waiters = new Map<string, Set<Waiter>>();

  /**
   * Wait until `id`'s projection satisfies `until` — checked against the
   * stored row first, then after every catch-up. Resolves the projection;
   * rejects once `budgetMs` of AWAKE time passed (a machine asleep applies
   * nothing, so a sleep spends none of it), or once `signal` aborts.
   */
  async function wait(
    id: string,
    until: (s: AgentProjection) => boolean,
    budgetMs: number,
    what: string,
    signal?: AbortSignal,
  ): Promise<AgentProjection> {
    let resolve!: (s: AgentProjection) => void;
    let reject!: (e: Error) => void;
    const done = new Promise<AgentProjection>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const waiter: Waiter = { until, resolve };
    const set = waiters.get(id) ?? new Set();
    waiters.set(id, set);
    set.add(waiter);
    const expire = () => reject(new ProjectionTimeoutError(id, what, budgetMs));
    const cancel = armAwakeDeadline(budgetMs, expire, { clock: deps.clock });
    const onAbort = () => reject(new ProjectionWaitAbortedError(id, what));
    if (signal?.aborted) onAbort();
    signal?.addEventListener("abort", onAbort);
    try {
      // Registered before the read, so a catch-up landing in between wakes it.
      const current = await deps.current(id);
      if (current && until(current)) return current;
      // Lines may already be on disk that no watch event announced yet.
      deps.catchUp(id);
      return await done;
    } finally {
      cancel();
      signal?.removeEventListener("abort", onAbort);
      set.delete(waiter);
      if (set.size === 0) waiters.delete(id);
    }
  }

  /** A catch-up applied `state`: resolve the waits it satisfies. */
  function applied(id: string, state: AgentProjection): void {
    for (const w of [...(waiters.get(id) ?? [])]) {
      if (w.until(state)) w.resolve(state);
    }
  }

  return { wait, applied };
}
