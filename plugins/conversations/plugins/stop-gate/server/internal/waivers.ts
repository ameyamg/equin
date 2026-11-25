import { StopWaiver } from "./registry";

/**
 * Why this conversation's agent will be woken anyway — every StopWaiver that
 * waives now, its reason (background work in flight, a watched subtree still
 * running, a compaction): its stop is a pause, not the end of its run. Empty
 * when none waives. A waiver that throws fails the read, loudly.
 */
export async function wakeReasons(conversationId: string): Promise<string[]> {
  const reasons = await Promise.all(
    StopWaiver.getContributions().map((w) => w.waives(conversationId)),
  );
  return reasons.filter((r): r is string => r !== null);
}
