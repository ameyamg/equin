// The consumer's boot owns every agent's first catch-up: while it runs, what a
// follow hears (an append, its open's re-read, a loss) only marks the agent,
// and the boot pass catches each marked agent up — a few at once — instead of
// every follow starting its own at once, unbounded, then the pass running the
// same agents again. Once the boot is done (`release`), whatever was heard
// after the pass took an agent is caught up, and later hearings go straight
// through.

export interface BootHold {
  /** A follow heard `id`: held during the boot, caught up at once after. */
  heard(id: string): void;
  /** The agents heard and not yet claimed. */
  pending(): string[];
  /** The boot pass takes `id`: what was heard of it so far, its run reads. */
  claim(id: string): void;
  /** The boot is done: catch up what is still held; pass hearings through from now. */
  release(): void;
}

export function createBootHold(catchUp: (id: string) => void): BootHold {
  let held: Set<string> | null = new Set();
  return {
    heard(id) {
      if (held) held.add(id);
      else catchUp(id);
    },
    pending: () => [...(held ?? [])],
    claim(id) {
      held?.delete(id);
    },
    release() {
      const left = held;
      held = null;
      for (const id of left ?? []) catchUp(id);
    },
  };
}

/** A hold already released: every hearing goes straight through. */
export function releasedHold(catchUp: (id: string) => void): BootHold {
  const hold = createBootHold(catchUp);
  hold.release();
  return hold;
}
