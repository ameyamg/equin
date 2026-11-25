import { defineServerContribution } from "@plugins/framework/plugins/server-core/core";
import type { DbExecutor } from "@plugins/tasks/plugins/tasks-core/server";

/**
 * Something a role session holds that its successor takes over when it hands
 * off (`handoff`): contributed by whoever wires that holding in (the
 * `handoff` child: the open decisions), so the take names none. Runs on the
 * launch's transaction once the new root exists; returns the line the new
 * session's brief says about what it took, or `null` when there was nothing.
 */
export interface SessionHandoffCarryEntry {
  /** Unique (diagnostics). */
  id: string;
  carry: (
    fromTaskId: string,
    toTaskId: string,
    tx: DbExecutor,
  ) => Promise<string | null>;
}

const CarryToken = defineServerContribution<SessionHandoffCarryEntry>(
  "supervisorSessionHandoffCarry",
  { docLabel: (c) => c.id },
);

/** Registers a carry — `SessionHandoff.Carry({ id, carry })`. */
export const SessionHandoff = { Carry: CarryToken };

/** The registered carries (the booted plugin graph's). */
export function handoffCarries(): readonly SessionHandoffCarryEntry[] {
  return CarryToken.getContributions();
}

/** Run `carries` in order; the lines they returned. */
export async function runCarries(
  carries: readonly SessionHandoffCarryEntry[],
  fromTaskId: string,
  toTaskId: string,
  tx: DbExecutor,
): Promise<string[]> {
  const lines: string[] = [];
  for (const entry of carries) {
    const line = await entry.carry(fromTaskId, toTaskId, tx);
    if (line !== null) lines.push(line);
  }
  return lines;
}
