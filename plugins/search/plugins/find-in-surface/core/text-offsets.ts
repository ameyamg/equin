/**
 * Where one text node starts in a region's joined text, and how long it is.
 * The joined text also holds line breaks that belong to no node (between two
 * blocks), so consecutive parts are not always contiguous.
 */
export interface TextPart {
  at: number;
  length: number;
}

/** A position inside one part: its index and the offset within it. */
export interface PartPoint {
  part: number;
  offset: number;
}

/** The last part starting at or before `at` (parts are sorted by `at`). */
function lastStartingBy(parts: readonly TextPart[], at: number): number {
  let lo = 0;
  let hi = parts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (parts[mid]!.at <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Where a match starting at `index` begins. A match may start on a line break
 * that is in no node; it then begins at the start of the next node.
 */
export function startPoint(
  parts: readonly TextPart[],
  index: number,
): PartPoint {
  if (parts.length === 0) throw new Error("startPoint: no text parts");
  const i = lastStartingBy(parts, index);
  const part = parts[i]!;
  const offset = index - part.at;
  if (offset >= part.length && i + 1 < parts.length)
    return { part: i + 1, offset: 0 };
  return { part: i, offset: Math.max(0, Math.min(offset, part.length)) };
}

/**
 * Where a match ending at `end` (exclusive) stops. A match may end on a line
 * break that is in no node; it then stops at the end of the node before it.
 */
export function endPoint(parts: readonly TextPart[], end: number): PartPoint {
  if (parts.length === 0) throw new Error("endPoint: no text parts");
  const i = lastStartingBy(parts, end - 1);
  const part = parts[i]!;
  return { part: i, offset: Math.max(0, Math.min(end - part.at, part.length)) };
}
