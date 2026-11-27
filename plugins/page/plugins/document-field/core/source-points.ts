import type { SourceLine } from "./source";

/**
 * A caret position both modes can name: a leaf block (its index among the
 * document's leaf blocks, in document order — see `SourceLine.block`) and an
 * offset in that block's TEXT (its runs for a line, its code for a fence).
 */
export interface BlockPoint {
  block: number;
  offset: number;
}

/** The source offset a block point stands at, clamped into the block. */
export function sourceOffsetOf(lines: SourceLine[], point: BlockPoint): number {
  const own = lines.filter((l) => l.block === point.block);
  const first = own[0];
  if (!first) {
    // Past the last block (the other mode held one more): the end.
    return lines.at(-1)?.end ?? 0;
  }
  if (first.kind === "text" && first.scan) {
    const { sourceOf } = first.scan;
    const offset = Math.max(0, Math.min(point.offset, sourceOf.length));
    return offset === 0
      ? first.contentStart
      : first.contentStart + sourceOf[offset - 1]! + 1;
  }
  const body = own.filter((l) => l.kind === "code");
  if (body.length > 0) {
    // A fence: its code is the body lines, contiguous in the source.
    const start = body[0]!.start;
    const end = body.at(-1)!.end;
    return Math.min(start + Math.max(0, point.offset), end);
  }
  return first.start;
}

/** The block point a source offset stands at — the nearest block's, after it when between. */
export function blockPointOf(lines: SourceLine[], at: number): BlockPoint {
  const index = lines.findIndex((l) => at >= l.start && at <= l.end);
  const line = lines[index];
  if (!line) return { block: 0, offset: 0 };
  if (line.block === null) {
    const next = lines.slice(index + 1).find((l) => l.block !== null);
    if (next) return { block: next.block!, offset: 0 };
    const prev = lines
      .slice(0, index)
      .reverse()
      .find((l) => l.block !== null);
    return prev ? endOf(lines, prev.block!) : { block: 0, offset: 0 };
  }
  if (line.kind === "text" && line.scan) {
    const rel = at - line.contentStart;
    let offset = 0;
    for (const src of line.scan.sourceOf) if (src < rel) offset++;
    return { block: line.block, offset };
  }
  if (line.kind === "code") {
    const body = lines.filter(
      (l) => l.block === line.block && l.kind === "code",
    );
    return { block: line.block, offset: at - body[0]!.start };
  }
  return { block: line.block, offset: 0 };
}

function endOf(lines: SourceLine[], block: number): BlockPoint {
  const own = lines.filter((l) => l.block === block);
  const text = own.find((l) => l.kind === "text");
  if (text?.scan) return { block, offset: text.scan.sourceOf.length };
  const body = own.filter((l) => l.kind === "code");
  if (body.length > 0)
    return { block, offset: body.at(-1)!.end - body[0]!.start };
  return { block, offset: 0 };
}
