/** Where an upload stands: the next chunk it takes and the last one's size. */
export interface ChunkCursor {
  nextSeq: number;
  /** The size of chunk `nextSeq - 1`, `null` before the first. */
  lastSize: number | null;
}

/**
 * What to do with chunk `seq` of `size` bytes: append it (the next one), skip
 * it (a replay of the last, same size — a retried request whose first try
 * landed), or refuse it (a gap or a different replay: never reorder).
 */
export function chunkDecision(
  cursor: ChunkCursor,
  seq: number,
  size: number,
):
  | { kind: "append" }
  | { kind: "replay" }
  | { kind: "conflict"; message: string } {
  if (seq === cursor.nextSeq) return { kind: "append" };
  if (seq === cursor.nextSeq - 1 && size === cursor.lastSize)
    return { kind: "replay" };
  return {
    kind: "conflict",
    message: `chunk ${seq} arrived, expected ${cursor.nextSeq}`,
  };
}
