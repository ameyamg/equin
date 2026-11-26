import type { EventsRead } from "./event-reader";

// What the consumer's boot did, per agent: the follows it opened and the
// catch-ups it ran (what each read, and whether it fell back to the whole
// file family). One summary line per boot, so a slow `follow-scan` or
// `catch-up` step names its agent and its cause.

interface AgentCost {
  ms: number;
  bytes: number;
  events: number;
  whole: boolean;
}

export interface BootTally {
  /** A follow of `id` opened, in `ms`. */
  opened(id: string, ms: number): void;
  /** A catch-up of `id` read this. */
  read(id: string, read: EventsRead): void;
  /** A boot catch-up of `id` settled, in `ms` (its reads included). */
  caughtUp(id: string, ms: number): void;
  /** `id`'s events file ends where its row's cursor does: nothing to catch up. */
  current(id: string): void;
  /** The one-line summary. */
  summary(): string;
}

export function createBootTally(): BootTally {
  const opens = new Map<string, number>();
  let current = 0;
  const catchUps = new Map<string, AgentCost>();
  const costOf = (id: string): AgentCost => {
    let cost = catchUps.get(id);
    if (!cost) {
      cost = { ms: 0, bytes: 0, events: 0, whole: false };
      catchUps.set(id, cost);
    }
    return cost;
  };
  return {
    opened(id, ms) {
      opens.set(id, (opens.get(id) ?? 0) + ms);
    },
    read(id, read) {
      const cost = costOf(id);
      cost.bytes += read.bytes;
      cost.events += read.events.length;
      // Read from the start and something was there: no stored position or a
      // lost one, paid for (an empty family costs nothing to re-read).
      cost.whole ||= read.whole && read.bytes > 0;
    },
    caughtUp(id, ms) {
      costOf(id).ms += ms;
    },
    current() {
      current += 1;
    },
    summary() {
      const openMs = [...opens.values()].reduce((a, b) => a + b, 0);
      const slowestOpen = maxBy([...opens], ([, ms]) => ms);
      const costs = [...catchUps];
      const sum = (f: (c: AgentCost) => number) =>
        costs.reduce((a, [, c]) => a + f(c), 0);
      const slowest = maxBy(costs, ([, c]) => c.ms);
      const biggest = maxBy(costs, ([, c]) => c.bytes);
      const whole = costs.filter(([, c]) => c.whole).map(([id]) => id);
      return [
        `follows opened: ${String(opens.size)}, ${ms(openMs)} summed`,
        slowestOpen ? ` (slowest ${slowestOpen[0]} ${ms(slowestOpen[1])})` : "",
        `; already current: ${String(current)}`,
        `; agents caught up: ${String(costs.length)}, ${ms(sum((c) => c.ms))} summed (queueing included)`,
        slowest ? `, slowest ${slowest[0]} ${ms(slowest[1].ms)}` : "",
        `; read ${kb(sum((c) => c.bytes))}, ${String(sum((c) => c.events))} events`,
        biggest && biggest[1].bytes > 0
          ? ` (most ${biggest[0]} ${kb(biggest[1].bytes)})`
          : "",
        `; whole-file re-reads: ${whole.length === 0 ? "none" : whole.join(", ")}`,
      ].join("");
    },
  };
}

function maxBy<T>(items: readonly T[], key: (t: T) => number): T | undefined {
  let best: T | undefined;
  for (const item of items)
    if (best === undefined || key(item) > key(best)) best = item;
  return best;
}

const ms = (n: number) => `${String(Math.round(n))} ms`;
const kb = (n: number) => `${String(Math.round(n / 1024))} KB`;
